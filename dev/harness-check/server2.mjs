// Spike 2: web_search returns text + structuredContent (different prices); web_fetch returns text only, with app data in _meta.
import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'mcpgw-spike', version: '0.0.1' });
  server.registerTool('web_search', {
    description: 'Search the web for current information.', annotations,
    inputSchema: z.object({ query: z.string().min(1) }),
    outputSchema: z.object({ query: z.string(), snippet: z.string() }),
  }, async ({ query }) => ({
    content: [{ type: 'text', text: 'TEXT-BLOCK says gold is $1,111.11' }],
    structuredContent: { query, snippet: 'STRUCTURED says gold is $2,222.22' },
  }));
  server.registerTool('web_fetch', {
    description: 'Read one web page as plain text.', annotations,
    inputSchema: z.object({ url: z.string() }),
  }, async ({ url }) => ({
    content: [{ type: 'text', text: 'TEXT-ONLY says gold is $3,333.33. (truncated: call again with start=12000 for more)' }],
    _meta: { 'arch.internal/mcpgw': { final_url: url, note: 'METAFIELD says gold is $4,444.44' } },
  }));
  return server;
});
const app = createMcpHonoApp({ host: '0.0.0.0', allowedHosts: ['172.17.0.1'], allowedOrigins: JSON.parse(process.env.ORIGINS) });
app.all('/mcp', (c) => handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }));
serve({ fetch: app.fetch, hostname: '172.17.0.1', port: Number(process.env.PORT) });
