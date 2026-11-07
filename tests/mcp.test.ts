import { request as httpRequest } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { META_KEY } from "../src/tools/result.js";
import { type RunningServer, rpcBody, startApp } from "./helpers.js";

let app: RunningServer;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

/** node:http rather than fetch: a test has to be able to send any Host header. */
function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: app.port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function rpc(method: string, params: unknown, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

const INITIALIZE = rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
});

describe("guards", () => {
  it("accepts the names callers use", async () => {
    for (const host of ["mcpgw.mcpgw.svc.cluster.local", "mcpgw.mcpgw.svc.cluster.local:3002"]) {
      const res = await send("POST", "/mcp", { ...JSON_HEADERS, host }, INITIALIZE);
      expect(res.status, host).toBe(200);
    }
  });

  it("refuses a Host it doesn't serve (DNS rebinding), and the name it used to have", async () => {
    for (const host of ["evil.example", "mcpgw.arch.internal", "mcpgw.mcpgw"]) {
      const res = await send("POST", "/mcp", { ...JSON_HEADERS, host }, INITIALIZE);
      expect(res.status, host).toBe(403);
    }
  });

  it("refuses any browser Origin, even one of ours", async () => {
    for (const origin of ["http://evil.example", "http://homestorm.arch.internal"]) {
      const res = await send("POST", "/mcp", { ...JSON_HEADERS, origin }, INITIALIZE);
      expect(res.status, origin).toBe(403);
    }
  });

  it("answers 405 to GET and DELETE: a stateless server has nothing to push", async () => {
    expect((await send("GET", "/mcp", { accept: "text/event-stream" })).status).toBe(405);
    expect((await send("DELETE", "/mcp")).status).toBe(405);
  });

  it("refuses a body over the limit", async () => {
    const big = rpc("tools/call", {
      name: "web_search",
      arguments: { query: "x".repeat(1100000) },
    });
    const res = await send("POST", "/mcp", JSON_HEADERS, big);
    expect(res.status).toBe(413);
  });
});

describe("other routes", () => {
  it("/health answers a Kubernetes probe's pod-IP Host", async () => {
    const res = await send("GET", "/health", { host: "10.42.0.5:3002" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).status).toBe("ok");
  });

  it("/ reports the version", async () => {
    const res = await send("GET", "/", { host: "10.42.0.5:3002" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ name: "mcpgw" });
  });

  it("returns its own request ID on every kind of response", async () => {
    const pattern = /^[0-9a-f-]{36}$/;
    const mcp = await send("POST", "/mcp", JSON_HEADERS, INITIALIZE);
    expect(mcp.headers["x-request-id"]).toMatch(pattern);
    const refused = await send("POST", "/mcp", { ...JSON_HEADERS, host: "evil.example" }, "{}");
    expect(refused.headers["x-request-id"]).toMatch(pattern);
    const health = await send("GET", "/health");
    expect(health.headers["x-request-id"]).toMatch(pattern);
  });
});

describe("the 2025 protocol, as Codex speaks it", () => {
  const headers = { ...JSON_HEADERS, "mcp-protocol-version": "2025-06-18" };

  it("initializes, lists and calls with no session", async () => {
    const init = await send("POST", "/mcp", JSON_HEADERS, INITIALIZE);
    expect(init.status).toBe(200);
    expect(init.headers["mcp-session-id"]).toBeUndefined();
    const hello = rpcBody(String(init.headers["content-type"]), init.body);
    expect(hello.result.serverInfo.name).toBe("mcpgw");

    const list = await send("POST", "/mcp", headers, rpc("tools/list", {}, 2));
    const tools = rpcBody(String(list.headers["content-type"]), list.body).result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toContain("web_search");

    const call = await send(
      "POST",
      "/mcp",
      headers,
      rpc("tools/call", { name: "web_search", arguments: { query: "gold" } }, 3),
    );
    const result = rpcBody(String(call.headers["content-type"]), call.body).result;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("gold");
  });
});

describe("the 2026-07-28 protocol, as Claude Code speaks it", () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
  };
  const headersFor = (method: string, name?: string) => ({
    ...JSON_HEADERS,
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
  });

  it("discovers, lists and calls", async () => {
    const discover = await send(
      "POST",
      "/mcp",
      headersFor("server/discover"),
      rpc("server/discover", { _meta: meta }),
    );
    expect(discover.status).toBe(200);
    const found = rpcBody(String(discover.headers["content-type"]), discover.body).result;
    expect(found.supportedVersions).toContain("2026-07-28");
    expect(found.capabilities.tools).toBeDefined();

    const list = await send(
      "POST",
      "/mcp",
      headersFor("tools/list"),
      rpc("tools/list", { _meta: meta }, 2),
    );
    const listed = rpcBody(String(list.headers["content-type"]), list.body).result;
    const tools = listed.tools;
    expect(tools.map((t: { name: string }) => t.name)).toContain("web_search");
    // The SDK's default of 0 tells every client to fetch the same two tools again each time.
    expect(listed.ttlMs).toBe(300_000);
    expect(listed.cacheScope).toBe("public");

    const call = await send(
      "POST",
      "/mcp",
      headersFor("tools/call", "web_search"),
      rpc("tools/call", { name: "web_search", arguments: { query: "gold" }, _meta: meta }, 3),
    );
    const result = rpcBody(String(call.headers["content-type"]), call.body).result;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("gold");
  });
});

describe("through the SDK's v2 client, as an app calls it", () => {
  let mcp: Client;
  beforeAll(async () => {
    mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${app.url}/mcp`)));
  });
  afterAll(() => mcp.close());

  it("lists tools with the annotations harnesses rely on, and only query required", async () => {
    const { tools } = await mcp.listTools();
    const search = tools.find((t) => t.name === "web_search");
    expect(search?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(search?.inputSchema.required).toEqual(["query"]);
    expect(search?.outputSchema).toBeUndefined();
  });

  it("returns text for the model and data in _meta, never structuredContent", async () => {
    const result = await mcp.callTool({ name: "web_search", arguments: { query: "gold" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect((result.content as { text: string }[])[0]?.text).toContain('Results for "gold"');
    const meta = result._meta?.[META_KEY] as { query: string; results: unknown[] };
    expect(meta.query).toBe("gold");
    expect(meta.results).toHaveLength(1);
  });

  it("reports bad arguments as a tool error the model can read", async () => {
    const result = await mcp.callTool({ name: "web_search", arguments: { query: "" } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toMatch(/query/);
  });

  it("reports an unknown tool as a protocol error", async () => {
    await expect(mcp.callTool({ name: "nope", arguments: {} })).rejects.toMatchObject({
      code: -32602,
    });
  });
});
