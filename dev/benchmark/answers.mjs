// Asks every question through one setup and saves what happened. Only the tools differ between the
// claude-* arms: same model, same system prompt, same questions.
//   node answers.mjs --arm claude-builtin|claude-mcpgw|claude-none|gpt-mcpgw --label baseline --run 1
//                    [--set core|hard] [--only a,b]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { args, http, LLMGW, load, MCPGW, mcp, RESULTS, save, sleep } from "./lib.mjs";
import { hardQuestions, liveKeys, questions, systemPrompt } from "./questions.mjs";

const opts = args({ arm: "claude-builtin", label: "baseline", run: "1", model: "", only: "", gap: "6000", set: "core" });
const today = new Date().toISOString().slice(0, 10);
const SYSTEM = systemPrompt(today);
const QUESTION_TIMEOUT_MS = 240_000;
const emptySearch = (text) => /^No results for /.test(text);

/** Claude Code in print mode, away from any project, with one user's settings and memory left out. */
function runClaude(question, tools) {
  const cwd = mkdtempSync(join(tmpdir(), "mcpgw-benchmark-"));
  const argv = [
    "-p", question,
    "--model", opts.model || "haiku",
    "--system-prompt", SYSTEM,
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
    ...tools,
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => child.kill("SIGTERM"), QUESTION_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const calls = [];
      const byId = new Map();
      let answer = "";
      let cost = null;
      let turns = null;
      let failure = null;
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "assistant") {
          for (const c of e.message?.content ?? []) {
            if (c.type === "tool_use") {
              const call = { tool: c.name.replace("mcp__mcpgw__", ""), arg: c.input?.query ?? c.input?.url ?? null, input: c.input, error: false, empty: false, chars: 0 };
              calls.push(call);
              byId.set(c.id, call);
            }
          }
        } else if (e.type === "user") {
          for (const c of e.message?.content ?? []) {
            if (c.type !== "tool_result") continue;
            const call = byId.get(c.tool_use_id);
            if (!call) continue;
            const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x) => x.text ?? "").join("\n");
            call.error = Boolean(c.is_error);
            call.chars = text.length;
            call.empty = emptySearch(text);
            if (call.error) call.message = text.slice(0, 120);
          }
        } else if (e.type === "result") {
          answer = e.result ?? "";
          cost = e.total_cost_usd ?? null;
          turns = e.num_turns ?? null;
          if (e.is_error) failure = String(e.result ?? e.subtype).slice(0, 200);
        }
      }
      if (!answer && !failure) failure = `claude exited ${code}: ${err.slice(0, 200)}`;
      resolve({ answer, calls, cost, turns, failure });
    });
  });
}

/** Plays homestorm's part: the tool list from mcpgw, the model through llmgw, at most 4 calls. */
let openAiTools;
async function runGpt(question) {
  openAiTools ??= (await mcp("tools/list")).tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  const calls = [];
  for (let step = 0; step <= 4; step++) {
    const body = { model: opts.model || "gpt-5.6-luna", messages, max_tokens: 1500, ...(step < 4 ? { tools: openAiTools } : {}) };
    if (step === 4) messages.push({ role: "user", content: "Answer now from what you found. Say what you couldn't confirm." });
    const reply = JSON.parse(await http(`${LLMGW}/chat/completions`, { body }));
    const msg = reply.choices[0].message;
    if (!msg.tool_calls?.length) return { answer: msg.content ?? "", calls, cost: null, turns: step + 1, failure: null };
    messages.push(msg);
    for (const c of msg.tool_calls) {
      const input = JSON.parse(c.function.arguments || "{}");
      const res = await mcp("tools/call", { name: c.function.name, arguments: input });
      const text = (res.content ?? []).map((x) => x.text ?? "").join("\n");
      const call = { tool: c.function.name, arg: input.query ?? input.url ?? null, input, error: Boolean(res.isError), empty: emptySearch(text), chars: text.length };
      if (call.error) call.message = text.slice(0, 120);
      calls.push(call);
      messages.push({ role: "tool", tool_call_id: c.id, content: text });
    }
    await sleep(3000);
  }
  return { answer: "", calls, cost: null, turns: 5, failure: "no answer after 4 calls" };
}

const ARMS = {
  "claude-builtin": (q) => runClaude(q, ["--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch"]),
  // The control: what the model answers from memory alone. Anything it gets right here, the tools can't take credit for.
  "claude-none": (q) => runClaude(q, ["--tools", ""]),
  "claude-mcpgw": (q) =>
    runClaude(q, [
      "--tools", "",
      "--mcp-config", JSON.stringify({ mcpServers: { mcpgw: { type: "http", url: MCPGW } } }),
      "--allowedTools", "mcp__mcpgw__web_search,mcp__mcpgw__web_fetch",
    ]),
  "gpt-mcpgw": runGpt,
};
if (!ARMS[opts.arm]) throw new Error(`Unknown arm: ${opts.arm}`);

const dir = join(RESULTS, opts.label);
const keysPath = join(dir, "keys.json");
let keys;
try { keys = load(keysPath); } catch { keys = await liveKeys(); save(keysPath, keys); }
console.log("keys", JSON.stringify(keys));

const only = opts.only ? new Set(opts.only.split(",")) : null;
const list = (opts.set === "hard" ? hardQuestions(keys) : questions(keys)).filter((q) => !only || only.has(q.id));
const path = join(dir, `${opts.arm}-run${opts.run}.json`);
const rows = [];
for (const q of list) {
  const started = Date.now();
  let r;
  try { r = await ARMS[opts.arm](q.q); }
  catch (e) { r = { answer: "", calls: [], cost: null, turns: null, failure: String(e).slice(0, 200) }; }
  const row = { id: q.id, kind: q.kind, secs: Math.round((Date.now() - started) / 1000), ...r };
  rows.push(row);
  save(path, { arm: opts.arm, run: Number(opts.run), model: opts.model || null, date: today, rows });
  const bad = r.calls.filter((c) => c.error).length;
  const empty = r.calls.filter((c) => c.empty).length;
  console.log(`DONE ${rows.length}/${list.length} ${q.id} ${row.secs}s calls=${r.calls.length} errors=${bad} empty=${empty} ${r.failure ? `FAILURE ${r.failure}` : ""} | ${r.answer.replace(/\s+/g, " ").slice(0, 80)}`);
  await sleep(Number(opts.gap));
}
console.log(`ARM FINISHED ${opts.arm} run ${opts.run}`);
