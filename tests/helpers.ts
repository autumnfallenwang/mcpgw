import type { AddressInfo } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import { type AppDeps, createApp } from "../src/app.js";
import { ExtractorPool } from "../src/fetch/extractor-pool.js";
import { Fetcher } from "../src/fetch/fetcher.js";
import { DEFAULT_POLICY } from "../src/fetch/guard.js";
import { FetchService } from "../src/fetch/service.js";
import { cannedProvider } from "../src/search/canned.js";
import { SearchService } from "../src/search/service.js";

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** The real app on a real port, since the Host checks need real HTTP requests. */
export async function startApp(overrides: Partial<AppDeps> = {}): Promise<RunningServer> {
  const app = createApp({
    allowedHosts: ["127.0.0.1", "mcpgw.mcpgw.svc.cluster.local"],
    search: new SearchService(cannedProvider, { cacheTtlMs: 60_000, concurrency: 4 }),
    fetch: new FetchService(
      new Fetcher({ policy: DEFAULT_POLICY(250), timeoutMs: 2_000, maxBytes: 1024 * 1024 }),
      new ExtractorPool(),
      { cacheTtlMs: 60_000, concurrency: 4 },
    ),
    ...overrides,
  });
  const server: ServerType = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        if ("closeAllConnections" in server) server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Pulls the JSON-RPC message out of a response, whether it came as JSON or as one SSE event. */
// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary JSON-RPC results
export function rpcBody(contentType: string | null, body: string): Record<string, any> {
  if (contentType?.includes("text/event-stream")) {
    const data = body
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .at(-1);
    return JSON.parse(data ?? "{}");
  }
  return JSON.parse(body);
}
