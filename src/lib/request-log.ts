import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { log, withLogContext } from "./logger.js";

/** A caller's value goes into Loki only if it looks like an ID, never as free text. */
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
const CLIENT = /^[A-Za-z0-9._/-]{1,64}$/;

function clientName(c: Context): string | undefined {
  const named = c.req.header("x-client");
  if (named && CLIENT.test(named)) return named;
  const agent = c.req.header("user-agent")?.split(/\s/, 1)[0];
  return agent && CLIENT.test(agent) ? agent : undefined;
}

/**
 * One `http.request` line per request, in the house shape, and a `req_id` on every line logged while
 * handling it. A healthy `/health` isn't logged, since it would mostly be Kubernetes probes.
 */
export async function requestLog(c: Context, next: Next) {
  const reqId = randomUUID();
  const start = Date.now();
  const incoming = c.req.header("x-request-id");
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : undefined;
  const client = clientName(c);

  await withLogContext(
    {
      req_id: reqId,
      ...(requestId ? { request_id: requestId } : {}),
      ...(client ? { client } : {}),
    },
    next,
  );

  // After next(): a Response from the MCP handler wouldn't carry a header set before it.
  c.res.headers.set("X-Request-Id", reqId);

  const status = c.res.status;
  if (c.req.path === "/health" && status === 200) return;

  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  log[level](
    {
      event: "http.request",
      req_id: reqId,
      method: c.req.method,
      path: c.req.path,
      status,
      latency_ms: Date.now() - start,
      ...(client ? { client } : {}),
      ...(requestId ? { request_id: requestId } : {}),
      ...(status >= 500 && c.error ? { err: c.error } : {}),
    },
    "request handled",
  );
}
