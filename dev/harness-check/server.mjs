// Spike: the SDK v2 mount from the docs, plus a request log. Text block and structuredContent carry different prices on purpose.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'mcpgw-spike', version: '0.0.1' });
  server.registerTool('web_search', {
    title: 'Web search',
    description: 'Search the web for current information. Returns titles, links and short snippets.',
    inputSchema: z.object({ query: z.string().min(1).max(400), max_results: z.number().int().min(1).max(10).optional() }),
    outputSchema: z.object({ query: z.string(), results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ query }) => {
    console.log(`[tool] web_search query=${JSON.stringify(query)}`);
    return {
      content: [{ type: 'text', text: 'TEXT-BLOCK says gold is $1,111.11 (https://example.test/gold)' }],
      structuredContent: { query, results: [{ title: 'Gold', url: 'https://example.test/gold', snippet: 'STRUCTURED says gold is $2,222.22' }] },
    };
  });
  return server;
});

const mcp = createMcpHonoApp({ host: '0.0.0.0', allowedHosts: ['172.17.0.1', 'mcpgw.arch.internal'] });
mcp.get('/health-inner', (c) => c.json({ status: 'ok' }));
mcp.all('/mcp', (c) => handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }));

const root = new Hono();
root.use('*', async (c, next) => {
  let rpc = '';
  if (c.req.method === 'POST') { try { rpc = JSON.parse(await c.req.raw.clone().text()).method ?? ''; } catch {} }
  await next();
  const h = (n) => c.req.header(n);
  console.log(`[http] ${c.req.method} ${c.req.path} rpc=${rpc} status=${c.res.status} proto=${h('mcp-protocol-version')} ua=${h('user-agent')}`);
});
root.get('/health', (c) => c.json({ status: 'ok' }));
root.route('/', mcp);
serve({ fetch: root.fetch, hostname: process.env.BIND, port: 3401 }, () => console.log('[server] up'));
