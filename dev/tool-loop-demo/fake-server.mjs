// A fake MCP server: one web_search tool with canned results. Stands in for mcpgw.
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const FAKE = {
  gold: [
    { title: "Gold price today (test feed)", url: "https://example.test/gold",
      snippet: "Spot gold: $1,234.56 per troy ounce, up 0.4% today. Updated 2026-11-04 10:00 UTC." },
  ],
};

function makeServer() {
  const server = new McpServer({ name: "fake-mcpgw", version: "0.0.1" });
  server.registerTool(
    "web_search",
    {
      description:
        "Search the web for current information. Returns titles, links and short snippets.",
      inputSchema: { query: z.string().describe("What to search for"), max_results: z.number().int().optional() },
    },
    async ({ query }) => {
      console.log(`[server] tools/call web_search query=${JSON.stringify(query)}`);
      const results = /gold/i.test(query) ? FAKE.gold : [];
      const text = results.length
        ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n")
        : "No results.";
      return { content: [{ type: "text", text }], structuredContent: { query, results } };
    },
  );
  return server;
}

http
  .createServer(async (req, res) => {
    if (req.url !== "/mcp") return void res.writeHead(404).end();
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : undefined;
    if (parsed?.method) console.log(`[server] ${parsed.method}`);
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  })
  .listen(3399, "127.0.0.1", () => console.log("[server] fake MCP server on http://127.0.0.1:3399/mcp"));
