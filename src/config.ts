import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};

export const APP_NAME = "mcpgw";
export const APP_VERSION: string = pkg.version;
/** The commit the image was built from (CI passes it as a build arg); null in dev. */
export const APP_COMMIT: string | null = env.MCPGW_COMMIT || null;

export const PORT = Number(env.PORT ?? 3002);
export const LOG_LEVEL = env.LOG_LEVEL ?? "info";

/** Host names callers may use. Anything else gets a 403, which is what stops DNS rebinding. */
export const ALLOWED_HOSTS = (env.ALLOWED_HOSTS ?? "mcpgw.mcpgw.svc.cluster.local")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export const SEARCH_PROVIDER = env.SEARCH_PROVIDER ?? "searxng";
export const SEARXNG_URL = env.SEARXNG_URL ?? "http://searxng.mcpgw.svc.cluster.local:8080";
export const SEARCH_CACHE_TTL_S = Number(env.SEARCH_CACHE_TTL_S ?? 600);
export const SEARCH_CONCURRENCY = Number(env.SEARCH_CONCURRENCY ?? 4);
/**
 * The least time between searches, across all callers. Waiting calls queue. 2 s at first, after a burst drew CAPTCHAs; 1 s since
 * meeting-sized bursts at 1 s drew no refusals (ADR 0012, 2026-11-09).
 */
export const SEARCH_MIN_GAP_MS = Number(env.SEARCH_MIN_GAP_MS ?? 1_000);

export const FETCH_CACHE_TTL_S = Number(env.FETCH_CACHE_TTL_S ?? 600);
export const FETCH_CONCURRENCY = Number(env.FETCH_CONCURRENCY ?? 8);
export const FETCH_MIN_GAP_MS = Number(env.FETCH_MIN_GAP_MS ?? 200);
export const FETCH_TIMEOUT_MS = Number(env.FETCH_TIMEOUT_MS ?? 15_000);
export const FETCH_MAX_BYTES = Number(env.FETCH_MAX_BYTES ?? 5 * 1024 * 1024);
export const FETCH_MAX_URL_CHARS = Number(env.FETCH_MAX_URL_CHARS ?? 250);
