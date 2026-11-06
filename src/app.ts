import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { APP_COMMIT, APP_NAME, APP_VERSION } from "./config.js";
import { requestLog } from "./lib/request-log.js";
import { createMcpApp, type McpDeps } from "./mcp.js";

export type AppDeps = McpDeps;

const MAX_BODY_BYTES = 1024 * 1024;
const HEALTH_REFRESH_MS = 15_000;

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", requestLog);

  // Last known state, refreshed in the background. A probe mustn't wait on the backend: Kubernetes
  // gives it 1 s by default, and a slow search backend shouldn't restart mcpgw.
  const provider = deps.search.provider;
  let backend: "ok" | "down" | "unknown" = "unknown";
  let checkedAt = 0;
  const refreshBackend = () => {
    if (Date.now() - checkedAt < HEALTH_REFRESH_MS) return;
    checkedAt = Date.now();
    void provider.health().then((state) => {
      backend = state;
    });
  };

  // These come before the MCP app, whose Host check would refuse a Kubernetes probe's pod-IP Host.
  app.get("/", (c) =>
    c.json({
      name: APP_NAME,
      version: APP_VERSION,
      commit: APP_COMMIT,
      description: "Home cluster tool gateway. Models live in llmgw, tools live here.",
      mcp: "POST /mcp",
    }),
  );
  app.get("/health", (c) => {
    refreshBackend();
    return c.json({ status: "ok", [provider.name]: backend });
  });

  app.use(
    "/mcp",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: { message: "Request body too large" } }, 413),
    }),
  );
  app.route("/", createMcpApp(deps));
  return app;
}
