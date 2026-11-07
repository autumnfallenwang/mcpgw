// Is news search any good? retrieval.mjs only checks that a result mentions the topic, which missed that a real
// meeting's "technology news today" came back mostly off-topic. Here a judge model reads the results of each search,
// seeing only the query and today's date, and says which are recent news on the topic.
//   node news.mjs --label mylabel                                   through mcpgw, the way a model searches
//   node news.mjs --label mylabel --searxng http://127.0.0.1:8181 --engines "yahoo news,qwant news"   one engine at a time
import { join } from "node:path";
import { args, getJson, http, LLMGW, META_KEY, mcp, pct, RESULTS, save, sleep } from "./lib.mjs";

const opts = args({ label: "news", gap: "6000", judge: "gpt-5.6-terra", searxng: "", engines: "", range: "upstream" });
const date = new Date().toISOString().slice(0, 10);
const [y, m, d] = date.split("-").map(Number);
const MONTH = new Date(date).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

// The first two of each language are what seats really sent in a meeting.
const QUERIES = [
  ["en", `important technology news ${MONTH} ${d} ${y} today`, "day"],
  ["en", `technology news ${MONTH} ${d} ${y} AI cybersecurity semiconductor`, "day"],
  ["en", "AI news this week", "week"],
  ["en", "federal reserve interest rate decision", "month"],
  ["en", "nba news today", "day"],
  ["en", "US midterm election results", "week"],
  ["en", "stock market news today", "day"],
  ["en", "boston local news", "week"],
  ["zh", `科技新闻 ${y}年${m}月${d}日`, "day"],
  ["zh", `今日 科技新闻 ${y}年${m}月${d}日`, "day"],
  ["zh", "人工智能 最新消息", "week"],
  ["zh", "美国 中期选举 结果", "week"],
];

const viaMcp = async (query, range) => {
  const res = await mcp("tools/call", { name: "web_search", arguments: { query, category: "news", time_range: range } });
  return res._meta?.[META_KEY]?.results ?? [];
};

const viaEngine = (engine) => async (query, range) => {
  const url = new URL("/search", opts.searxng);
  const language = /[一-鿿]/.test(query) ? "zh-CN" : "en";
  // SearXNG skips any engine with no time-range support when asked for a range, which is most news engines. So
  // --range filter leaves it out and checks each result's date here instead.
  const upstream = opts.range === "upstream" ? { time_range: range } : {};
  const names = engine.split("+");
  for (const [k, v] of Object.entries({ q: query, format: "json", engines: names.join(","), language, ...upstream })) url.searchParams.set(k, v);
  const body = await getJson(url);
  // SearXNG quietly uses its usual engines if it doesn't know this one, which would make the score mean nothing.
  const strays = (body.results ?? []).flatMap((r) => r.engines ?? [r.engine]).filter((e) => !names.includes(e));
  if (strays.length) throw new Error(`Results from ${strays[0]}, not ${engine}`);
  const days = { day: 2, week: 8, month: 32 }[range];
  const recent = (r) => opts.range === "upstream" || !r.publishedDate || Date.now() - new Date(r.publishedDate).getTime() < days * 86_400_000;
  return (body.results ?? []).filter(recent).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.content, published: r.publishedDate, engines: r.engines }));
};

async function judge(query, range, hits) {
  if (hits.length === 0) return [];
  const list = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.published ? `Published ${h.published}. ` : ""}${String(h.snippet ?? "").slice(0, 300)}`).join("\n");
  const prompt = `Today is ${date}. Someone searched for news with the query "${query}", limited to the last ${range}.

Which results are worth giving them? A result counts only if it reports or tracks news on what the query is about, and nothing suggests it's older than that period. These don't count: stories on another subject, puzzle hints, adverts, product pages, reference pages, or old articles.

${list}

Reply with only JSON: {"verdicts":[true or false for each result, in order]}`;
  const reply = JSON.parse(await http(`${LLMGW}/chat/completions`, { body: { model: opts.judge, messages: [{ role: "user", content: prompt }], max_tokens: 400 } }));
  const text = reply.choices[0].message.content;
  const verdicts = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).verdicts;
  if (!Array.isArray(verdicts) || verdicts.length !== hits.length) throw new Error(`Bad judge reply: ${text.slice(0, 120)}`);
  return verdicts.map(Boolean);
}

async function run(name, search) {
  const rows = [];
  for (const [lang, query, range] of QUERIES) {
    const r = { lang, query, range, results: [], good: 0, error: null };
    try {
      const hits = (await search(query, range)).slice(0, 5);
      const verdicts = await judge(query, range, hits);
      r.results = hits.map((h, i) => ({ title: h.title, url: h.url, published: h.published ?? null, engines: h.engines, good: verdicts[i] }));
      r.good = verdicts.filter(Boolean).length;
    } catch (e) {
      r.error = String(e).slice(0, 160);
    }
    rows.push(r);
    console.log(`${name.padEnd(16)} ${r.good}/${r.results.length} ${lang} ${query.slice(0, 50)}${r.error ? ` ERROR ${r.error}` : ""}`);
    await sleep(Number(opts.gap));
  }
  const of = (lang) => rows.filter((r) => !lang || r.lang === lang);
  const score = (rs) => `${rs.reduce((n, r) => n + r.good, 0)}/${rs.length * 5}`;
  const summary = { name, good_of_5_each: score(of()), pct: pct(of().reduce((n, r) => n + r.good, 0), of().length * 5), en: score(of("en")), zh: score(of("zh")), empty: of().filter((r) => !r.results.length).length, errors: of().filter((r) => r.error).length };
  console.log(JSON.stringify(summary));
  return { summary, rows };
}

const engines = opts.engines ? opts.engines.split(",").map((e) => e.trim()) : [];
const out = [];
if (engines.length) for (const e of engines) out.push(await run(e, viaEngine(e)));
else out.push(await run("mcpgw", viaMcp));
save(join(RESULTS, opts.label, "news.json"), { label: opts.label, date, judge: opts.judge, runs: out });
console.log(out.map((o) => `${o.summary.name}: ${o.summary.pct}% (en ${o.summary.en}, zh ${o.summary.zh}, empty ${o.summary.empty})`).join("\n"));
