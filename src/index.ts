import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ALLOWED_HOSTS, PORT, SEARCH_PROVIDER } from "./config.js";
import { log } from "./lib/logger.js";
import { cannedProvider } from "./search/canned.js";
import type { SearchProvider } from "./search/types.js";

function searchProvider(): SearchProvider {
  if (SEARCH_PROVIDER === "canned") return cannedProvider;
  throw new Error(`Unknown SEARCH_PROVIDER: ${SEARCH_PROVIDER}`);
}

const app = createApp({ allowedHosts: ALLOWED_HOSTS, searchProvider: searchProvider() });

const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: PORT }, () => {
  log.info(
    { event: "server.start", port: PORT, search_provider: SEARCH_PROVIDER },
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
