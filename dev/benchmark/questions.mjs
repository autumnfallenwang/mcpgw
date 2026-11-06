// What the answer benchmark asks. Keys come from each project's own data at run time, or were checked
// by hand on 2026-11-06 against the sources noted, so neither a model's memory nor a guess can pass.
import { getJson, http } from "./lib.mjs";

const exactly = (value) => `(?<![\\d.])${String(value).replace(/^v/, "").replace(/\./g, "\\.")}(?![\\d])`;

const endOfLife = async (product, pick = () => true) =>
  (await getJson(`https://endoflife.date/api/${product}.json`)).find(pick).latest;
const npm = async (name) => (await getJson(`https://registry.npmjs.org/${name}/latest`)).version;

export async function liveKeys() {
  const nws = await getJson("https://api.weather.gov/gridpoints/BOX/71,101/forecast");
  const tomorrow = nws.properties.periods.find((p) => p.isDaytime && new Date(p.startTime) > new Date());
  return {
    postgres: await endOfLife("postgresql"),
    node: await endOfLife("nodejs", (r) => r.lts),
    python: await endOfLife("python"),
    linux: (await getJson("https://www.kernel.org/releases.json")).latest_stable.version,
    typescript: await npm("typescript"),
    hono: await npm("hono"),
    next: await npm("next"),
    react: await npm("react"),
    kubernetes: (await http("https://dl.k8s.io/release/stable.txt")).trim().replace(/^v/, ""),
    grafana: (await getJson("https://api.github.com/repos/grafana/grafana/releases/latest")).tag_name.replace(/^v/, ""),
    claudeCode: await npm("@anthropic-ai/claude-code"),
    bostonDay: tomorrow.name,
    bostonHigh: tomorrow.temperature,
  };
}

/** `match`: a regex the answer must contain to be right. `rubric`: guidance for the blind grader. */
export function questions(k) {
  const version = (id, q, value) => ({
    id,
    kind: "fresh",
    q: `${q} Give the exact version number.`,
    match: exactly(value),
    rubric: `The correct answer is ${value}.`,
  });
  return [
    version("postgres", "What is the latest stable PostgreSQL release?", k.postgres),
    version("node", "What is the newest Node.js LTS release?", k.node),
    version("python", "What is the latest stable Python release?", k.python),
    version("linux", "What is the latest stable Linux kernel release?", k.linux),
    version("typescript", "What is the latest stable TypeScript release?", k.typescript),
    version("hono", "What is the latest release of the Hono web framework on npm?", k.hono),
    version("next", "What is the latest stable Next.js release?", k.next),
    version("react", "What is the latest stable React release?", k.react),
    version("kubernetes", "What is the latest stable Kubernetes release?", k.kubernetes),
    version("grafana", "What is the latest stable Grafana release?", k.grafana),

    { id: "fed", kind: "dated", q: "What did the Federal Reserve decide at its October 2026 interest rate meeting, and what's the target range?", match: "3[.,]75.{0,12}4(?:[.,]00?)?", rubric: "It held rates unchanged at a target range of 3.75% to 4.00% (federalreserve.gov, October 28, 2026)." },
    { id: "nba", kind: "dated", q: "Who won the 2026 NBA Finals, and what was the series score?", match: "(?=[\\s\\S]*Knicks)[\\s\\S]*4[-–—]1", rubric: "The New York Knicks beat the San Antonio Spurs 4-1." },
    { id: "uscis-fee", kind: "dated", q: "What is the current USCIS premium processing fee for an EB-2 NIW Form I-140?", match: "2,?965", rubric: "$2,965, since March 1, 2026." },
    { id: "world-cup", kind: "dated", q: "Who won the 2026 FIFA World Cup, and what was the score in the final?", match: "(?=[\\s\\S]*Spain)[\\s\\S]*1[-–—]0", rubric: "Spain beat Argentina 1-0 after extra time." },
    { id: "nobel", kind: "dated", q: "Who won the 2026 Nobel Prize in Physics, and for what?", match: "Halzen", rubric: "Francis Halzen, for the IceCube Neutrino Observatory and high-energy astrophysical neutrinos." },
    { id: "super-bowl", kind: "dated", q: "Who won Super Bowl LX, and what was the final score?", match: "(?=[\\s\\S]*Seahawks)[\\s\\S]*29[-–—]13", rubric: "The Seattle Seahawks beat the New England Patriots 29-13." },
    { id: "oscars", kind: "dated", q: "Which film won Best Picture at the 98th Academy Awards?", match: "One Battle After Another", rubric: "One Battle After Another." },

    { id: "hono-bearer", kind: "docs", q: "In Hono's documentation, what's the import path for the Bearer Auth middleware?", match: "hono/bearer-auth", rubric: "hono/bearer-auth." },
    { id: "better-auth", kind: "docs", q: "In Better Auth's documentation, which option sets a custom prefix for its cookies?", match: "cookiePrefix", rubric: "advanced.cookiePrefix." },
    { id: "nftables", kind: "docs", q: "In nftables, what numeric value does the `raw` priority keyword stand for in the ip family?", match: "-\\s?300", rubric: "-300." },
    { id: "drizzle", kind: "docs", q: "According to Drizzle's documentation, which drizzle-kit command generates SQL migration files?", match: "drizzle-kit generate", rubric: "drizzle-kit generate." },
    { id: "rfc9110", kind: "docs", q: "Which section number of RFC 9110 defines idempotent methods?", match: "9\\.2\\.2", rubric: "Section 9.2.2." },

    { id: "pdf-i140", kind: "pdf", q: "Read https://www.uscis.gov/sites/default/files/document/forms/i-140instr.pdf and tell me the edition date in its page footer.", match: "0?6/0?7/(?:20)?24|June 7,? 2024", rubric: "06/07/24." },
    { id: "pdf-w9", kind: "pdf", q: "Read https://www.irs.gov/pub/irs-pdf/fw9.pdf and tell me the catalog number (Cat. No.) printed on it.", match: "10231X", rubric: "10231X." },
    { id: "pdf-paper", kind: "pdf", q: "Read https://arxiv.org/pdf/1706.03762 and tell me the value of warmup_steps the paper used.", match: "4,?000", rubric: "4000." },

    { id: "zh-postgres", kind: "chinese", q: "PostgreSQL 目前最新的稳定版本号是多少？请给出确切的版本号。", match: exactly(k.postgres), rubric: `正确答案是 ${k.postgres}。` },
    { id: "zh-world-cup", kind: "chinese", q: "2026 年世界杯的冠军是哪支球队？决赛比分是多少？", match: "(?=[\\s\\S]*西班牙)[\\s\\S]*1\\s?[-–—比:：]\\s?0", rubric: "西班牙 1-0 战胜阿根廷（加时赛）。" },
    { id: "zh-niw", kind: "chinese", q: "美国 EB-2 NIW 的 Dhanasar 三项标准是什么？请用中文回答，并给出来源链接。", rubric: "Answered in Chinese with the three prongs: substantial merit and national importance; well positioned to advance the endeavor; on balance beneficial to waive the job offer and labor certification. Right needs all three and a source link." },
    { id: "zh-news", kind: "chinese", q: "最近有什么重要的科技新闻？请用中文列出三条，并给出来源链接。", rubric: "Answered in Chinese with three real technology news items, each with a link, from about the last few weeks. Partial if fewer than three or if the links are generic home pages. Declined if it says it couldn't find any." },

    { id: "stack-overflow", kind: "blocked", q: "On Stack Overflow, question 11227809 asks why processing a sorted array is faster. Who wrote the top answer, and what's the main explanation?", match: "(?=[\\s\\S]*Mysticial)[\\s\\S]*[Bb]ranch predict", rubric: "Mysticial; branch prediction." },

    { id: "weather", kind: "everyday", q: `What's the forecast high temperature for Boston on ${k.bostonDay}?`, rubric: `The National Weather Service says a high of ${k.bostonHigh}°F. Right if within 5°F. Wrong if further off. Partial if it gives a range overlapping that or no number but a sensible forecast source.` },
    { id: "sourdough", kind: "everyday", q: "Why does my sourdough bread come out dense, and how do I fix it? Cite a source.", rubric: "Sound advice such as under- or over-proofing, a weak starter, or weak gluten, with a source link. Partial without a link." },
  ];
}

/**
 * Harder, and mostly too recent for any model to know: the answers sit in one source, sometimes deep in
 * a long document. Checked by hand on 2026-11-06 against the primary sources noted. `--set hard` runs them.
 */
export function hardQuestions(k) {
  return [
    { id: "ecb", kind: "hard", q: "What was the European Central Bank's euro reference rate against the US dollar on 5 November 2026?", match: "1[.,]1224", rubric: "1.1224 (ecb.europa.eu)." },
    { id: "quake", kind: "hard", q: "A magnitude 6.1 earthquake struck on 6 November 2026 (UTC), according to the USGS. Near where was it?", match: "Hasaki|[Jj]apan", rubric: "144 km SE of Hasaki, Japan. Fiji was the day before, so that's wrong." },
    { id: "nba-game", kind: "hard", q: "What was the final score of the Orlando Magic at Phoenix Suns game on 5 November 2026?", match: "117[\\s\\S]{0,30}104|104[\\s\\S]{0,30}117", rubric: "Phoenix Suns 117, Orlando Magic 104 (ESPN)." },
    { id: "claude-code", kind: "hard", q: "What's the latest version of Claude Code (@anthropic-ai/claude-code) on npm? Give the exact version number.", match: exactly(k.claudeCode), rubric: `${k.claudeCode}.` },
    { id: "irs-wage-base", kind: "hard", q: "Read IRS Publication 15 at https://www.irs.gov/pub/irs-pdf/p15.pdf. What is the social security wage base limit it gives for 2026?", match: "184,?500", rubric: "$184,500." },
    { id: "python-pep", kind: "hard", q: "According to What's New In Python 3.15 on docs.python.org, which PEP number adds explicit lazy imports?", match: "810", rubric: "PEP 810." },
    { id: "golden-ball", kind: "hard", q: "Who won the Golden Ball as best player at the 2026 FIFA World Cup?", match: "Rodri", rubric: "Rodri, of Spain." },
    { id: "zh-lpr", kind: "hard", q: "2026 年 10 月公布的中国贷款市场报价利率（LPR）是多少？请分别给出 1 年期和 5 年期以上的数值。", match: "3(?:\\.0+)?\\s?%[\\s\\S]*3\\.5\\s?%", rubric: "1 年期 3.0%，5 年期以上 3.5%。" },
  ];
}

export const systemPrompt = (date) =>
  `You are a helpful assistant. Today is ${date}. Your training data is older than today. Answer questions about anything current from your web tools, not from memory. If you couldn't find or confirm something, say so rather than guess. Cite the links you used. Be brief.`;
