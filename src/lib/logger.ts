// The house log contract, the same across the home apps so one Loki query works for all of them:
//
//   log.info({ event, req_id, latency_ms, ... }, "static message")
//
// One JSON object per line on stdout. The message is static: anything that varies goes in a field,
// or the line can't be counted, grouped or alerted on.

import { AsyncLocalStorage } from "node:async_hooks";
import { pino } from "pino";
import { APP_NAME, APP_VERSION, LOG_LEVEL } from "../config.js";

export interface LogContext {
  /** mcpgw's own ID for this request. Returned in X-Request-Id. */
  req_id: string;
  /** The caller's ID for this work, if it sent one. homestorm sends one per seat turn. */
  request_id?: string;
  /** Who's calling: X-Client, or else the first word of User-Agent. */
  client?: string;
}

const context = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(fields: LogContext, fn: () => T): T {
  return context.run(fields, fn);
}

export function logContext(): LogContext | undefined {
  return context.getStore();
}

export const log = pino({
  level: LOG_LEVEL,
  base: { service: APP_NAME, version: APP_VERSION },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin: () => {
    const reqId = context.getStore()?.req_id;
    return reqId ? { req_id: reqId } : {};
  },
});
