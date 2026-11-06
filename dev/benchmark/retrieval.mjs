// Tool-level test with no model, so it costs no allowance: searches scored on whether results are on
// the topic, and pages on whether they gave usable text. Paced to protect the home IP.
//   node retrieval.mjs --label baseline
import { join } from "node:path";
import { args, META_KEY, mcp, median, pct, RESULTS, save, sleep } from "./lib.mjs";

const opts = args({ label: "baseline", gap: "6000", pages: "yes", out: "retrieval" });

// kind, query, arguments, and a regex for the query's real subject.
const SEARCHES = [
  ["docs", "kubernetes networkpolicy documentation", {}, "(?i)network ?polic"],
  ["docs", "hono web framework documentation", {}, "(?i)\\bhono\\b"],
  ["docs", "python asyncio taskgroup docs", {}, "(?i)taskgroup"],
  ["docs", "drizzle orm migrations guide", {}, "(?i)drizzle"],
  ["docs", "better-auth cookie prefix option", {}, "(?i)better.?auth"],
  ["docs", "nftables prerouting raw priority", {}, "(?i)nftables|netfilter"],
  ["debug", "kubernetes pod CrashLoopBackOff how to debug", {}, "(?i)crashloop"],
  ["debug", "TypeError cannot read properties of undefined reading map react", {}, "(?i)cannot read|undefined"],
  ["fresh", "latest stable postgresql version", {}, "(?i)postgres"],
  ["fresh", "latest node.js LTS version", {}, "(?i)node\\.?js"],
  ["fresh", "current linux kernel stable version", {}, "(?i)kernel"],
  ["fresh", "latest python release", {}, "(?i)python"],
  ["news", "AI news this week", { category: "news", time_range: "week" }, "\\bAI\\b|(?i)artificial intelligence|openai|anthropic"],
  ["news", "federal reserve interest rate decision", { category: "news" }, "(?i)\\bfed\\b|federal reserve"],
  ["news", "nba news today", { category: "news", time_range: "day" }, "(?i)\\bnba\\b|magic|lakers|celtics|knicks"],
  ["everyday", "weather boston today", {}, "(?i)boston"],
  ["everyday", "best time to visit japan", {}, "(?i)japan"],
  ["everyday", "why does my sourdough bread come out dense and how do i fix it", {}, "(?i)sourdough"],
  ["everyday", "iphone 17 pro price", {}, "(?i)iphone 17"],
  ["facts", "who is the CEO of anthropic", {}, "(?i)anthropic|amodei"],
  ["facts", "boston residential tax exemption deadline", {}, "(?i)boston"],
  ["facts", "uscis eb2 niw premium processing fee", {}, "(?i)niw|eb-?2|premium processing|uscis"],
  ["chinese", "如何申请美国 NIW 移民", { language: "zh" }, "(?i)NIW|移民"],
  ["chinese", "如何申请美国 NIW 移民", {}, "(?i)NIW|移民"],
  ["chinese", "今天 科技 新闻", { language: "zh" }, "科技|新闻"],
  ["science", "attention is all you need paper", { category: "science" }, "(?i)attention"],
  ["it", "hono middleware example", { category: "it" }, "(?i)\\bhono\\b"],
  ["operators", "site:postgresql.org release notes", {}, "postgresql\\.org"],
  ["operators", "site:postgresql.org/about/news release", {}, "postgresql\\.org"],
  ["operators", "site:kubernetes.io network policy", {}, "kubernetes\\.io"],
  ["longkw", "PostgreSQL 18 minor release notes August 2026", {}, "(?i)postgres"],
];

// kind, URL, a regex usable text should contain, and the least text that counts as usable.
const PAGES = [
  ["wiki", "https://en.wikipedia.org/wiki/Web_scraping", "scraping", 2000],
  ["docs", "https://kubernetes.io/docs/concepts/services-networking/network-policies/", "NetworkPolicy", 2000],
  ["docs", "https://docs.python.org/3/library/asyncio-task.html", "TaskGroup", 2000],
  ["docs", "https://react.dev/learn", "component", 1000],
  ["docs", "https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/overview", "C#", 1000],
  ["code", "https://github.com/mozilla/readability", "Readability", 1000],
  ["code", "https://github.com/searxng/searxng/issues/1", ".", 300],
  ["code", "https://www.npmjs.com/package/hono", "[Hh]ono", 500],
  ["qa", "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array", "branch predict", 500],
  ["social", "https://www.reddit.com/r/selfhosted/", "selfhosted", 500],
  ["social", "https://x.com/AnthropicAI", "Anthropic", 800],
  ["social", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Never Gonna", 300],
  ["blog", "https://simonwillison.net/", ".", 2000],
  ["blog", "https://medium.com/@karpathy/software-2-0-a64152b37c35", "Software 2\\.0", 500],
  ["paper", "https://arxiv.org/abs/1706.03762", "[Aa]ttention", 500],
  ["pdf", "https://arxiv.org/pdf/1706.03762", "warmup", 2000],
  ["pdf", "https://www.uscis.gov/sites/default/files/document/forms/i-140instr.pdf", "Petition", 2000],
  ["pdf", "https://www.irs.gov/pub/irs-pdf/fw9.pdf", "10231X|W-9", 2000],
  ["gov", "https://www.uscis.gov/working-in-the-united-states/permanent-workers/employment-based-immigration-second-preference-eb-2", "[Nn]ational [Ii]nterest", 1000],
  ["gov", "https://www.weather.gov/box/", "[Ff]orecast", 500],
  ["gov", "https://www.boston.gov/departments/assessing", "[Aa]ssess", 500],
  ["news", "https://www.bbc.com/news", ".", 1500],
  ["news", "https://apnews.com/", ".", 1500],
  ["news", "https://www.reuters.com/", ".", 1500],
  ["news", "https://www.nytimes.com/", ".", 1500],
  ["shop", "https://www.apple.com/iphone/", "iPhone", 1000],
  ["shop", "https://www.amazon.com/dp/B0CHWRXH8B", "AirPods", 1000],
  ["recipe", "https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/", "butter", 500],
  ["spa", "https://www.google.com/maps", ".", 500],
  ["chinese", "https://zh.wikipedia.org/wiki/%E7%B6%B2%E9%A0%81%E6%8A%93%E5%8F%96", "[\\u4e00-\\u9fff]{20}", 500],
  ["chinese", "https://www.163.com/", "[\\u4e00-\\u9fff]{4}", 1000],
  ["chinese", "https://www.zhihu.com/question/19550256", "[\\u4e00-\\u9fff]{4}", 300],
  ["data", "https://api.github.com/repos/searxng/searxng", "searxng", 500],
  ["data", "https://hnrss.org/frontpage", ".", 1000],
  ["long", "https://www.rfc-editor.org/rfc/rfc9110.html", "HTTP Semantics", 2000],
  ["text", "https://www.rfc-editor.org/rfc/rfc2616.txt", "Hypertext", 2000],
];

// JavaScript regexes have no inline (?i), so it's lifted out here.
const compile = (s) => (s.includes("(?i)") ? new RegExp(s.replaceAll("(?i)", ""), "i") : new RegExp(s));

const searches = [];
for (const [kind, query, extra, topic] of SEARCHES) {
  const started = Date.now();
  let r = { kind, query, args: extra, results: [], onTopic: 0, firstOk: false, error: null };
  try {
    const res = await mcp("tools/call", { name: "web_search", arguments: { query, ...extra } });
    const meta = res._meta?.[META_KEY] ?? {};
    const hits = meta.results ?? [];
    const re = compile(topic);
    const flags = hits.map((h) => re.test(`${h.url} ${h.title} ${h.snippet ?? ""}`));
    r = {
      ...r,
      results: hits.map((h, i) => ({ url: h.url, title: h.title, engines: h.engines, on: flags[i] })),
      onTopic: flags.filter(Boolean).length,
      firstOk: Boolean(flags[0]),
      error: res.isError ? res.content?.[0]?.text?.slice(0, 120) : null,
      cached: meta.cached ?? null,
    };
  } catch (e) {
    r.error = String(e).slice(0, 120);
  }
  r.secs = Math.round((Date.now() - started) / 100) / 10;
  searches.push(r);
  console.log(`search ${r.onTopic}/${r.results.length} ${r.firstOk ? "first-ok " : "first-BAD"} ${r.secs}s ${kind.padEnd(9)} ${query.slice(0, 44).padEnd(44)} ${[...new Set(r.results.flatMap((x) => x.engines ?? []))].join(",").slice(0, 34)} ${r.error ?? ""}`);
  await sleep(Number(opts.gap));
}

const pages = [];
for (const [kind, url, want, minChars] of opts.pages === "yes" ? PAGES : []) {
  const started = Date.now();
  const r = { kind, url, usable: false, chars: 0, linkShare: 0, error: null };
  try {
    const res = await mcp("tools/call", { name: "web_fetch", arguments: { url } });
    const text = res.content?.[0]?.text ?? "";
    const body = text.split("\n").slice(3).join("\n");
    const links = (body.match(/\]\([^)\s]*\)/g) ?? []).join("").length;
    r.chars = body.length;
    r.linkShare = pct(links, body.length);
    r.error = res.isError ? text.slice(0, 100) : null;
    r.usable = !res.isError && !body.includes("It had no readable text") && body.length >= minChars && compile(want).test(body);
  } catch (e) {
    r.error = String(e).slice(0, 120);
  }
  r.secs = Math.round((Date.now() - started) / 100) / 10;
  pages.push(r);
  console.log(`fetch  ${r.usable ? "usable" : "NOT   "} ${String(r.chars).padStart(6)}c links ${String(r.linkShare).padStart(2)}% ${r.secs}s ${kind.padEnd(8)} ${url.slice(0, 58).padEnd(58)} ${r.error ?? ""}`);
  await sleep(1500);
}

const hits = searches.flatMap((s) => s.results);
const engineCount = {};
for (const h of hits) for (const e of h.engines ?? []) engineCount[e] = (engineCount[e] ?? 0) + 1;
const byKind = {};
for (const s of searches) {
  byKind[s.kind] ??= { on: 0, total: 0 };
  byKind[s.kind].on += s.onTopic;
  byKind[s.kind].total += s.results.length;
}
const summary = {
  label: opts.label,
  date: new Date().toISOString(),
  searches: searches.length,
  on_topic_pct: pct(searches.reduce((a, s) => a + s.onTopic, 0), hits.length),
  on_topic: `${searches.reduce((a, s) => a + s.onTopic, 0)}/${hits.length}`,
  first_ok: `${searches.filter((s) => s.firstOk).length}/${searches.length}`,
  empty: searches.filter((s) => !s.results.length && !s.error).length,
  failed: searches.filter((s) => s.error).length,
  median_search_secs: median(searches.map((s) => s.secs)),
  by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, `${v.on}/${v.total}`])),
  engines: engineCount,
  pages: pages.length,
  usable_pages: pages.filter((p) => p.usable).length,
  median_fetch_secs: median(pages.map((p) => p.secs)),
  median_link_share_pct: median(pages.filter((p) => p.chars >= 1500).map((p) => p.linkShare)),
  not_usable: pages.filter((p) => !p.usable).map((p) => `${p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 34)}: ${(p.error ?? `${p.chars} chars`).slice(0, 44)}`),
};
save(join(RESULTS, opts.label, `${opts.out}.json`), { summary, searches, pages });
console.log("RETRIEVAL FINISHED");
console.log(JSON.stringify(summary, null, 1));
