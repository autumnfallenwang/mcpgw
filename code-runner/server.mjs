// code_run's runner: mcpgw posts Python here, and each piece runs in a fresh, locked-down process (pool.mjs). It runs in
// its own pod, which a NetworkPolicy lets talk to nothing and only mcpgw talk to (ADR 0014).
//   POST /run {code} → {status, output, truncated, value?, error?, run_ms?, waited_ms?}
//   GET /health      → always 200, with the pool's state
//   GET /ready       → 200 once a runner is started ahead
import { Pool } from "./pool.mjs";

const num = (name, fallback) => Number(Deno.env.get(name) ?? fallback);
const PORT = num("CODE_RUNNER_PORT", 8080);
const MAX_CODE_CHARS = num("CODE_RUN_MAX_CHARS", 20_000);

const log = (fields) =>
  console.log(
    JSON.stringify({ time: new Date().toISOString(), service: "code-runner", ...fields }),
  );

const pool = new Pool({
  dir: new URL(".", import.meta.url).pathname.replace(/\/$/, ""),
  size: num("CODE_RUNNER_POOL", 2),
  maxRunning: num("CODE_RUNNER_MAX_RUNNING", 2),
  timeoutMs: num("CODE_RUN_TIMEOUT_MS", 20_000),
  queueTimeoutMs: num("CODE_RUN_QUEUE_TIMEOUT_MS", 30_000),
  log,
});
pool.start();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const server = Deno.serve(
  { hostname: "0.0.0.0", port: PORT, onListen: () => log({ event: "server.start", port: PORT }) },
  async (req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/health")
      return json({ status: "ok", ...pool.stats() });
    if (req.method === "GET" && pathname === "/ready") {
      const stats = pool.stats();
      return json({ ok: stats.ready > 0, ...stats }, stats.ready > 0 ? 200 : 503);
    }
    if (req.method !== "POST" || pathname !== "/run") return json({ error: "not found" }, 404);

    const body = await req.text();
    if (body.length > MAX_CODE_CHARS * 2 + 1024) return json({ error: "too large" }, 413);
    let code;
    try {
      ({ code } = JSON.parse(body));
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    if (typeof code !== "string" || code.length === 0 || code.length > MAX_CODE_CHARS) {
      return json({ error: `code must be a string of 1 to ${MAX_CODE_CHARS} characters` }, 400);
    }
    const started = performance.now();
    const result = await pool.run(code);
    // Never the code or what it printed: either may hold meeting content. Only sizes and the outcome.
    log({
      event: "code.run",
      status: result.status,
      code_chars: code.length,
      output_chars: result.output.length,
      truncated: result.truncated,
      run_ms: result.run_ms,
      waited_ms: result.waited_ms,
      duration_ms: Math.round(performance.now() - started),
    });
    return json(result);
  },
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  Deno.addSignalListener(signal, async () => {
    await server.shutdown();
    await pool.close();
    Deno.exit(0);
  });
}
