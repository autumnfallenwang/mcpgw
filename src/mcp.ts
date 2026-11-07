import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { APP_NAME, APP_VERSION } from "./config.js";
import type { FetchService } from "./fetch/service.js";
import type { SearchService } from "./search/service.js";
import { runTool } from "./tools/result.js";
import { WEB_FETCH_DESCRIPTION, webFetch, webFetchInput } from "./tools/web-fetch.js";
import { WEB_SEARCH_DESCRIPTION, webSearch, webSearchInput } from "./tools/web-search.js";

export interface McpDeps {
  allowedHosts: string[];
  search: SearchService;
  fetch: FetchService;
}

/**
 * Neither tool changes anything on the caller's side, and both reach the open web. Without
 * `readOnlyHint`, `codex exec` refused to run the tool. The same hint means Codex then runs it
 * without asking, which is why ADR 0007 has `web_fetch` ask through a client setting instead.
 */
const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** What each tool tells callers. The MCP server registers these, and the /docs page shows them. */
export const TOOLS = {
  web_search: {
    title: "Web search",
    description: WEB_SEARCH_DESCRIPTION,
    inputSchema: webSearchInput,
    annotations: ANNOTATIONS,
  },
  web_fetch: {
    title: "Web fetch",
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: webFetchInput,
    annotations: ANNOTATIONS,
  },
};

/** The tools only change with a new image and are the same for everyone, so anyone may keep them for a while. */
const TOOL_LIST_CACHE = { ttlMs: 5 * 60_000, cacheScope: "public" } as const;

export function createMcpApp(deps: McpDeps) {
  // One fresh McpServer per request: this is what makes the endpoint stateless, and the default
  // `legacy: "stateless"` also serves the 2025 protocol Codex still speaks (ADR 0003).
  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: APP_NAME, version: APP_VERSION },
      { cacheHints: { "tools/list": TOOL_LIST_CACHE, "server/discover": TOOL_LIST_CACHE } },
    );
    server.registerTool("web_search", TOOLS.web_search, (args) =>
      runTool("web_search", () => webSearch(args, deps.search)),
    );
    server.registerTool("web_fetch", TOOLS.web_fetch, (args) =>
      runTool("web_fetch", () => webFetch(args, deps.fetch)),
    );
    return server;
  });

  // host + allowedHosts: refuse any Host we don't serve. allowedOrigins: []: refuse every browser
  // page. Without it a hostile Origin got a 200, because binding to all interfaces drops the SDK's
  // defaults (dev/harness-check/README.md). Nothing in a browser should call mcpgw.
  const mcp = createMcpHonoApp({
    host: "0.0.0.0",
    allowedHosts: deps.allowedHosts,
    allowedOrigins: [],
  });
  mcp.all("/mcp", (c: Context) => handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") }));
  return mcp;
}
