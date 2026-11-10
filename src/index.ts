import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createCodeRunner } from "./code/runner.js";
import {
  ALLOWED_HOSTS,
  CODE_RUN_TIMEOUT_MS,
  CODE_RUNNER_URL,
  CODE_RUNNER_WAIT_MS,
  FETCH_CACHE_TTL_S,
  FETCH_CONCURRENCY,
  FETCH_MAX_BYTES,
  FETCH_MAX_URL_CHARS,
  FETCH_MIN_GAP_MS,
  FETCH_TIMEOUT_MS,
  PORT,
  SEARCH_CACHE_TTL_S,
  SEARCH_CONCURRENCY,
  SEARCH_MIN_GAP_MS,
  SEARCH_PROVIDER,
  SEARXNG_URL,
} from "./config.js";
import { ExtractorPool } from "./fetch/extractor-pool.js";
import { Fetcher } from "./fetch/fetcher.js";
import { DEFAULT_POLICY } from "./fetch/guard.js";
import { FetchService } from "./fetch/service.js";
import { log } from "./lib/logger.js";
import { cannedProvider } from "./search/canned.js";
import { createSearxngProvider } from "./search/searxng.js";
import { SearchService } from "./search/service.js";
import type { SearchProvider } from "./search/types.js";

function searchProvider(): SearchProvider {
  if (SEARCH_PROVIDER === "canned") return cannedProvider;
  if (SEARCH_PROVIDER === "searxng") return createSearxngProvider(SEARXNG_URL);
  throw new Error(`Unknown SEARCH_PROVIDER: ${SEARCH_PROVIDER}`);
}

const search = new SearchService(searchProvider(), {
  cacheTtlMs: SEARCH_CACHE_TTL_S * 1000,
  concurrency: SEARCH_CONCURRENCY,
  minGapMs: SEARCH_MIN_GAP_MS,
});

const fetchService = new FetchService(
  new Fetcher({
    policy: DEFAULT_POLICY(FETCH_MAX_URL_CHARS),
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: FETCH_MAX_BYTES,
  }),
  new ExtractorPool(),
  {
    cacheTtlMs: FETCH_CACHE_TTL_S * 1000,
    concurrency: FETCH_CONCURRENCY,
    minGapMs: FETCH_MIN_GAP_MS,
  },
);

const app = createApp({
  allowedHosts: ALLOWED_HOSTS,
  search,
  fetch: fetchService,
  ...(CODE_RUNNER_URL
    ? {
        code: {
          runner: createCodeRunner(CODE_RUNNER_URL, CODE_RUNNER_WAIT_MS),
          timeoutMs: CODE_RUN_TIMEOUT_MS,
        },
      }
    : {}),
});

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: PORT }, () => {
  log.info(
    {
      event: "server.start",
      port: PORT,
      search_provider: SEARCH_PROVIDER,
      ...(SEARCH_PROVIDER === "searxng" ? { searxng_url: SEARXNG_URL } : {}),
      code_runner_url: CODE_RUNNER_URL,
    },
    "mcpgw starting",
  );
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ event: "server.shutdown", signal }, "shutting down");
  // Long-lived MCP streams would otherwise hold close() open until Kubernetes kills the pod.
  server.close(() => process.exit(0));
  if ("closeAllConnections" in server) server.closeAllConnections();
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
