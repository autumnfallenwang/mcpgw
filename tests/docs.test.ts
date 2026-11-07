import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inputFields } from "../src/docs-page.js";
import { cannedProvider } from "../src/search/canned.js";
import { SearchService } from "../src/search/service.js";
import type { SearchProvider } from "../src/search/types.js";
import { webFetchInput } from "../src/tools/web-fetch.js";
import { webSearchInput } from "../src/tools/web-search.js";
import { type RunningServer, startApp } from "./helpers.js";

/** node:http rather than fetch: a test has to be able to send any Host header. */
function get(
  app: RunningServer,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: app.port, path, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

function withProvider(provider: Partial<SearchProvider>) {
  return new SearchService(
    { ...cannedProvider, ...provider },
    { cacheTtlMs: 60_000, concurrency: 4 },
  );
}

describe("/docs", () => {
  let app: RunningServer;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(() => app.close());

  it("shows the status, the tools and how to connect", async () => {
    const res = await get(app, "/docs");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    for (const text of ["web_search", "web_fetch", "max_chars", "tool.call", "Search backend"]) {
      expect(res.body).toContain(text);
    }
    expect(res.body).toContain(`http://127.0.0.1:${app.port}/mcp`);
  });

  it("states the URL limit the app really enforces, not the schema's wider one", async () => {
    const { body } = await get(app, "/docs");
    expect(body).toContain("string, up to 250 characters");
    expect(body).not.toContain("up to 8000 characters");
    expect(body).toContain("home network and cluster addresses are refused");
    expect(body).toContain("cached for 10 minutes");
  });

  it("answers to the name callers use, and refuses any other Host", async () => {
    const ok = await get(app, "/docs", { host: "mcpgw.mcpgw.svc.cluster.local" });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain("http://mcpgw.mcpgw.svc.cluster.local/mcp");
    for (const host of ["evil.example", "mcpgw.arch.internal", "10.42.0.5:3002"]) {
      const res = await get(app, "/docs", { host });
      expect(res.status, host).toBe(403);
      expect(res.body, host).not.toContain("web_search");
    }
  });

  it("runs no scripts and loads nothing from elsewhere", async () => {
    const res = await get(app, "/docs");
    expect(res.body).not.toMatch(/<script/i);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("/ points at it", async () => {
    const res = await get(app, "/");
    expect(JSON.parse(res.body).docs).toBe("/docs");
  });
});

describe("/docs with a backend in trouble", () => {
  it("still answers when the search backend is down, and says so", async () => {
    const app = await startApp({
      search: withProvider({ health: () => Promise.resolve("down") }),
    });
    try {
      const res = await get(app, "/docs");
      expect(res.status).toBe(200);
      expect(res.body).toContain("state-down");
    } finally {
      await app.close();
    }
  });

  it("still answers if the health check throws", async () => {
    const app = await startApp({
      search: withProvider({ health: () => Promise.reject(new Error("boom")) }),
    });
    try {
      const res = await get(app, "/docs");
      expect(res.status).toBe(200);
      expect(res.body).toContain("state-down");
    } finally {
      await app.close();
    }
  });

  it("lists failing engines, escaping what the backend said", async () => {
    const app = await startApp({
      search: withProvider({
        engineIssues: () => [
          {
            engine: "<b>brave</b>",
            reason: "<script>alert(1)</script>",
            lastAt: "2026-11-06T04:49:00.000Z",
            count: 3,
            pausedUntil: "2026-11-06T05:19:00.000Z",
          },
        ],
      }),
    });
    try {
      const res = await get(app, "/docs");
      expect(res.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(res.body).toContain("&lt;b&gt;brave&lt;/b&gt;");
      expect(res.body).toContain("2026-11-06 04:49 UTC");
      expect(res.body).toContain("2026-11-06 05:19 UTC");
      expect(res.body).not.toMatch(/<script/i);
    } finally {
      await app.close();
    }
  });

  it("says when no engine has failed, and leaves it out if the backend doesn't report", async () => {
    const quiet = await startApp({ search: withProvider({ engineIssues: () => [] }) });
    const silent = await startApp();
    try {
      expect((await get(quiet, "/docs")).body).toContain("failed in the last hour");
      expect((await get(silent, "/docs")).body).not.toContain("failed in the last hour");
    } finally {
      await quiet.close();
      await silent.close();
    }
  });
});

describe("inputFields", () => {
  it("describes each input from the tool's own schema", () => {
    const fields = Object.fromEntries(inputFields(webSearchInput).map((f) => [f.name, f]));
    expect(fields.query).toMatchObject({
      required: true,
      type: "string, up to 400 characters",
      description: "What to search for.",
    });
    expect(fields.max_results).toMatchObject({ required: false, type: "integer, 1 to 10" });
    expect(fields.time_range?.type).toBe("day, week, month, year");
  });

  it("doesn't print Zod's safe-integer limit as if it were a real one", () => {
    const start = inputFields(webFetchInput).find((f) => f.name === "start");
    expect(start?.type).toBe("integer, from 0");
  });
});
