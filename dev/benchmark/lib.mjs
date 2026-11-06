// Shared by the benchmark scripts. Node only, with no dependencies, like the rest of dev/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MCPGW = process.env.MCPGW_URL ?? "http://mcpgw.mcpgw.svc.cluster.local/mcp";
export const LLMGW = process.env.LLMGW_URL ?? "http://llmgw.llmgw.svc.cluster.local/v1";
export const RESULTS = join(import.meta.dirname, "results");
const UA = "mcpgw-benchmark/1";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function http(url, { body, headers, timeoutMs = 180_000 } = {}) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "user-agent": UA, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 160)}`);
  return text;
}

export const getJson = async (url) => JSON.parse(await http(url));

/** One MCP call. Stateless, so no session to set up. */
export async function mcp(method, params = {}, url = MCPGW) {
  let text = await http(url, {
    body: { jsonrpc: "2.0", id: 1, method, params },
    headers: { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
  });
  for (const line of text.split("\n")) if (line.startsWith("data:")) text = line.slice(5);
  const reply = JSON.parse(text);
  if (reply.error) throw new Error(JSON.stringify(reply.error));
  return reply.result;
}

export const META_KEY = "arch.internal/mcpgw";

export function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
}
export const load = (path) => JSON.parse(readFileSync(path, "utf-8"));

export function args(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
export const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
