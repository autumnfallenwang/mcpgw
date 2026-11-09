// The part of the monthly upkeep (docs/upkeep.md) that needs nothing from arch: newer versions of what mcpgw depends on, new MCP
// spec releases, and SearXNG changes since the pinned image to the engines mcpgw uses. Prints Markdown, with the steps that do
// need arch as a checklist. The upkeep workflow opens it as an issue each month.
//   node dev/upkeep/report.mjs > report.md      (GITHUB_TOKEN raises GitHub's rate limit)
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

async function get(url) {
  const auth = url.startsWith("https://api.github.com/") && process.env.GITHUB_TOKEN;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "mcpgw-upkeep",
      ...(auth ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const out = [];
const problems = [];

// ── Versions ──────────────────────────────────────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read("package.json"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const rows = [];
for (const [name, spec] of Object.entries(deps)) {
  try {
    const tags = await get(`https://registry.npmjs.org/-/package/${name.replace("/", "%2F")}/dist-tags`);
    const have = spec.replace(/^[\^~]/, "");
    if (tags.latest && tags.latest !== have) {
      const pinned = !/^[\^~]/.test(spec);
      rows.push(`| ${name} | ${spec} | ${tags.latest} | ${pinned ? "pinned exactly: read the changelog first" : ""} |`);
    }
  } catch (err) {
    problems.push(`npm ${name}: ${err.message}`);
  }
}
out.push("## 1. Versions", "");
if (rows.length === 0) out.push("Everything is on its latest version.");
else out.push("| Package | package.json | Latest | |", "|---|---|---|---|", ...rows);
out.push("", "Take patch and minor updates, then `pnpm lint && pnpm typecheck && pnpm test`.", "");

// ── MCP spec ──────────────────────────────────────────────────────────────────────────────────────────────────────
out.push("## 2. MCP spec", "");
try {
  const releases = await get(
    "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/releases?per_page=3",
  );
  for (const r of releases) out.push(`- ${r.tag_name}, ${r.published_at?.slice(0, 10)}`);
  out.push("", "mcpgw serves `2026-07-28` and the 2025 revision Codex uses. A newer revision means checking what a tools-only server must do.");
} catch (err) {
  problems.push(`MCP releases: ${err.message}`);
}
out.push("");

// ── SearXNG ───────────────────────────────────────────────────────────────────────────────────────────────────────
out.push("## 3. SearXNG", "");
const pinnedTag = /repository: searxng\/searxng\s+(?:#.*\s+)*tag:\s*(\S+)/.exec(read("deploy/chart/values.yaml"))?.[1];
const pinnedSha = pinnedTag?.split("-").pop();
// The engines settings.yml keeps, as their module files: "bing news" is bing_news.py, "brave.news" is brave.py.
const settings = read("deploy/chart/files/settings.yml");
const kept = [...(/keep_only:\n((?:\s+(?:- .+|#.*)\n)+)/.exec(settings)?.[1] ?? "").matchAll(/- (.+)/g)].map((m) =>
  m[1].trim(),
);
const modules = new Set(kept.flatMap((n) => [n.replace(/ /g, "_"), n.split(/[ .]/)[0]]));
try {
  const cmp = await get(`https://api.github.com/repos/searxng/searxng/compare/${pinnedSha}...master`);
  const touched = (cmp.files ?? [])
    .map((f) => f.filename)
    .filter((f) => /^searx\/engines\/[^/]+\.py$/.test(f) && modules.has(f.slice(13, -3)));
  out.push(`Pinned at \`${pinnedTag}\`. ${cmp.ahead_by ?? "?"} commits since.`, "");
  if (touched.length === 0) out.push("None of them change an engine mcpgw uses, so it can stay pinned.");
  else {
    out.push("Engines mcpgw uses that changed: move only for a fix, and benchmark the new image locally first.", "");
    for (const f of touched) out.push(`- \`${f}\``);
    const subjects = (cmp.commits ?? [])
      .map((c) => c.commit.message.split("\n")[0])
      .filter((s) => kept.some((n) => s.toLowerCase().includes(n.split(/[ .]/)[0])));
    if (subjects.length) out.push("", "Commits that name them:", "", ...subjects.map((s) => `- ${s}`));
  }
  const tags = await get("https://hub.docker.com/v2/repositories/searxng/searxng/tags?page_size=3&ordering=last_updated");
  const newest = (tags.results ?? []).map((t) => t.name).find((n) => /^\d{4}\.\d+\.\d+-/.test(n));
  if (newest) out.push("", `Newest image: \`${newest}\`.`);
} catch (err) {
  problems.push(`SearXNG: ${err.message}`);
}
out.push("");

// ── What needs arch ───────────────────────────────────────────────────────────────────────────────────────────────
out.push(
  "## 4. On arch",
  "",
  "- [ ] **Engines:** `/docs` on mcpgw, and `searxng.engine_paused` in Grafana. An engine left out for days means changing the mix (ADR 0012).",
  "- [ ] **Benchmarks,** paced: `node retrieval.mjs --label upkeep-YYYY-MM` and `node news.mjs --label upkeep-YYYY-MM`, compared with the last labels.",
  "- [ ] **Real use:** the month's tool calls in Grafana. What fails, what refuses, how long searches wait, and which pages come back `thin`.",
  "- [ ] **Log the pass** in `docs/progress.md`, then close this issue.",
  "",
  `The full checklist is [docs/upkeep.md](https://github.com/${process.env.GITHUB_REPOSITORY ?? "autumnfallenwang/mcpgw"}/blob/main/docs/upkeep.md).`,
);
if (problems.length) out.push("", "## Couldn't check", "", ...problems.map((p) => `- ${p}`));

console.log(out.join("\n"));
