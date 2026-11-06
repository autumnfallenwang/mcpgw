// Grades every saved answer and prints the comparison. A `match` regex decides the clear cases. The
// rest go to a judge model that sees only the question, the guidance and the answer, in shuffled order,
// and never which setup wrote it.
//   node grade.mjs --label baseline
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { args, http, LLMGW, load, median, RESULTS, save } from "./lib.mjs";
import { hardQuestions, questions } from "./questions.mjs";

const opts = args({ label: "baseline", judge: "gpt-5.6-terra" });
const dir = join(RESULTS, opts.label);
const keys = load(join(dir, "keys.json"));
const byId = new Map([...questions(keys), ...hardQuestions(keys)].map((q) => [q.id, q]));
const POINTS = { right: 1, partial: 0.5, declined: 0, wrong: -0.5 };

async function judge(q, answer, date) {
  if (!answer.trim()) return { grade: "declined", why: "No answer." };
  const prompt = `Grade an answer to a question. Reply with only JSON: {"grade":"right|partial|declined|wrong","why":"one short sentence"}.
- right: correct and complete, per the guidance.
- partial: correct in part, or correct but missing something the guidance requires.
- declined: it says it couldn't find or confirm the answer, and doesn't assert a wrong one.
- wrong: it asserts something the guidance contradicts.
Today is ${date}. Don't use your own knowledge of current facts: the guidance decides, and a date up to today isn't in the future.

Question: ${q.q}
Guidance: ${q.rubric}
Answer: ${answer.slice(0, 6000)}`;
  const reply = JSON.parse(await http(`${LLMGW}/chat/completions`, { body: { model: opts.judge, messages: [{ role: "user", content: prompt }], max_tokens: 200 } }));
  const text = reply.choices[0].message.content ?? "";
  const parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}");
  if (!(parsed.grade in POINTS)) throw new Error(`Bad judge reply: ${text.slice(0, 120)}`);
  return parsed;
}

const runs = readdirSync(dir).filter((f) => /-run\d+\.json$/.test(f)).map((f) => ({ file: f, ...load(join(dir, f)) }));
const items = runs.flatMap((run) => run.rows.map((row) => ({ run, row, q: byId.get(row.id) })));
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}
let gradesPath = join(dir, "grades.json");
let cache = {};
try { cache = load(gradesPath); } catch {}
for (const item of items) {
  const key = `${item.run.file}|${item.row.id}`;
  if (item.row.failure && !item.row.answer) {
    cache[key] = { grade: "declined", why: `Run failed: ${item.row.failure}`, by: "failure" };
  } else if (!cache[key] || cache[key].answer !== item.row.answer) {
    const hit = item.q.match && new RegExp(item.q.match).test(item.row.answer);
    cache[key] = hit ? { grade: "right", why: "Matched the key.", by: "key" } : { ...(await judge(item.q, item.row.answer, item.run.date)), by: "judge" };
    cache[key].answer = item.row.answer;
    save(gradesPath, cache);
  }
  item.grade = cache[key].grade;
  item.why = cache[key].why;
}
save(gradesPath, cache);

function summarize(list) {
  const n = list.length;
  const count = (g) => list.filter((i) => i.grade === g).length;
  const calls = list.flatMap((i) => i.row.calls);
  const searches = calls.filter((c) => /search/i.test(c.tool));
  const fetches = calls.filter((c) => /fetch/i.test(c.tool));
  return {
    n,
    right: count("right"),
    partial: count("partial"),
    declined: count("declined"),
    wrong: count("wrong"),
    score: Math.round((1000 * list.reduce((s, i) => s + POINTS[i.grade], 0)) / Math.max(n, 1)) / 10,
    calls_per_q: Math.round((10 * calls.length) / Math.max(n, 1)) / 10,
    searches: searches.length,
    empty_searches: searches.filter((c) => c.empty).length,
    failed_searches: searches.filter((c) => c.error).length,
    fetches: fetches.length,
    failed_fetches: fetches.filter((c) => c.error).length,
    median_secs: median(list.map((i) => i.row.secs)),
    cost_usd: Math.round(100 * list.reduce((s, i) => s + (i.row.cost ?? 0), 0)) / 100,
  };
}
const arms = [...new Set(items.map((i) => i.run.arm))].sort();
const kinds = [...new Set([...byId.values()].map((q) => q.kind))];
const summary = { label: opts.label, arms: {} };
for (const arm of arms) {
  const list = items.filter((i) => i.run.arm === arm);
  summary.arms[arm] = { all: summarize(list), kinds: Object.fromEntries(kinds.map((k) => [k, summarize(list.filter((i) => i.q.kind === k))])) };
}
save(join(dir, "summary.json"), summary);

const head = "arm".padEnd(16) + "runs".padStart(5) + "right".padStart(7) + "part".padStart(6) + "decl".padStart(6) + "wrong".padStart(7) + "score".padStart(7) + "calls/q".padStart(9) + "empty".padStart(8) + "f.fail".padStart(9) + "secs".padStart(6);
console.log(head);
for (const arm of arms) {
  const a = summary.arms[arm].all;
  console.log(arm.padEnd(16) + String(a.n).padStart(5) + String(a.right).padStart(7) + String(a.partial).padStart(6) + String(a.declined).padStart(6) + String(a.wrong).padStart(7) + String(a.score).padStart(7) + String(a.calls_per_q).padStart(9) + `${a.empty_searches}/${a.searches}`.padStart(8) + `${a.failed_fetches}/${a.fetches}`.padStart(9) + String(a.median_secs).padStart(6));
}
console.log("\nscore by kind (right=100, partial=50, declined=0, wrong=-50, averaged)");
console.log("kind".padEnd(11) + arms.map((a) => a.padStart(16)).join(""));
for (const k of kinds) console.log(k.padEnd(11) + arms.map((a) => `${summary.arms[a].kinds[k].score} (${summary.arms[a].kinds[k].right}/${summary.arms[a].kinds[k].n})`.padStart(16)).join(""));
console.log("\nnot right:");
for (const i of [...items].filter((x) => x.grade !== "right").sort((a, b) => a.row.id.localeCompare(b.row.id))) {
  console.log(`  ${i.row.id.padEnd(15)} ${i.run.arm.padEnd(15)} run${i.run.run} ${i.grade.padEnd(9)} ${String(i.why).slice(0, 96)}`);
}
