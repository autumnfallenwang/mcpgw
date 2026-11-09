import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  APP_COMMIT,
  APP_NAME,
  APP_VERSION,
  FETCH_CACHE_TTL_S,
  FETCH_MAX_URL_CHARS,
  SEARCH_CACHE_TTL_S,
  SEARCH_MIN_GAP_MS,
} from "./config.js";
import { renderDocsPage } from "./docs-page.js";
import { requestLog } from "./lib/request-log.js";
import { createMcpApp, type McpDeps, TOOLS } from "./mcp.js";

export type AppDeps = McpDeps;

function minutes(seconds: number): string {
  const count = Math.round(seconds / 60);
  return count === 1 ? "1 minute" : `${count} minutes`;
}

function seconds(ms: number): string {
  const count = ms / 1000;
  return count === 1 ? "1 second" : `${count} seconds`;
}

const MAX_BODY_BYTES = 1024 * 1024;
const HEALTH_REFRESH_MS = 15_000;
const DESCRIPTION = "Home cluster tool gateway. Models live in llmgw, tools live here.";

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", requestLog);

  // Last known state, refreshed in the background. A probe mustn't wait on the backend: Kubernetes
  // gives it 1 s by default, and a slow search backend shouldn't restart mcpgw.
  const provider = deps.search.provider;
  let backend: "ok" | "down" | "unknown" = "unknown";
  let checkedAt = 0;
  let checking: Promise<void> = Promise.resolve();
  const refreshBackend = () => {
    if (Date.now() - checkedAt >= HEALTH_REFRESH_MS) {
      checkedAt = Date.now();
      checking = provider
        .health()
        .catch(() => "down" as const)
        .then((state) => {
          backend = state;
        });
    }
    return checking;
  };
  const startedAt = new Date().toISOString();

  // These come before the MCP app, whose Host check would refuse a Kubernetes probe's pod-IP Host.
  app.get("/", (c) =>
    c.json({
      name: APP_NAME,
      version: APP_VERSION,
      commit: APP_COMMIT,
      description: DESCRIPTION,
      mcp: "POST /mcp",
      docs: "/docs",
    }),
  );
  app.get("/health", (c) => {
    void refreshBackend();
    return c.json({ status: "ok", [provider.name]: backend });
  });

  // For a person in a browser. Unlike a probe it can wait for a fresh health check, and it has the
  // same Host check as /mcp, so a rebinding page can't read it.
  app.get("/docs", async (c) => {
    const host = c.req.header("host") ?? "";
    if (!deps.allowedHosts.includes(host.replace(/:\d+$/, ""))) {
      return c.text("This Host isn't served here.", 403);
    }
    await refreshBackend();
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.html(
      renderDocsPage({
        name: APP_NAME,
        version: APP_VERSION,
        commit: APP_COMMIT,
        description: DESCRIPTION,
        startedAt,
        host,
        backendName: provider.name,
        backend,
        engineIssues: provider.engineIssues?.() ?? null,
        tools: [
          {
            name: "web_search",
            ...TOOLS.web_search,
            readOnly: TOOLS.web_search.annotations.readOnlyHint,
            note: `Results are cached for ${minutes(SEARCH_CACHE_TTL_S)}. Searches run at least ${seconds(SEARCH_MIN_GAP_MS)} apart across all callers, so a burst waits its turn.`,
          },
          {
            name: "web_fetch",
            ...TOOLS.web_fetch,
            readOnly: TOOLS.web_fetch.annotations.readOnlyHint,
            note: `Reads web pages, text and PDFs. Only reads public addresses: home network and cluster addresses are refused. Results are cached for ${minutes(FETCH_CACHE_TTL_S)}.`,
            inputTypes: { url: `string, up to ${FETCH_MAX_URL_CHARS} characters` },
          },
        ],
      }),
    );
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
