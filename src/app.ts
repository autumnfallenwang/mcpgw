import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { APP_COMMIT, APP_NAME, APP_VERSION } from "./config.js";
import { requestLog } from "./lib/request-log.js";
import { createMcpApp, type McpDeps } from "./mcp.js";

export type AppDeps = McpDeps;

const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", requestLog);

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
  app.get("/health", (c) => c.json({ status: "ok" }));

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
