// What homestorm would write if there were no REST mirror: v2 client, list, convert to OpenAI tools, call.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const mcp = new Client({ name: 'homestorm-spike', version: '0.0.1' });
await mcp.connect(new StreamableHTTPClientTransport(new URL('http://172.17.0.1:3401/mcp')));
const { tools } = await mcp.listTools();
const openai = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
console.log('tools:', tools.map((t) => t.name).join(','), '| annotations:', JSON.stringify(tools[0].annotations), '| openai params keys:', Object.keys(openai[0].function.parameters).join(','));
const r = await mcp.callTool({ name: 'web_search', arguments: { query: 'gold' } });
console.log('text:', r.content[0].text, '| structured:', JSON.stringify(r.structuredContent).slice(0, 90), '| isError:', r.isError);
const bad = await mcp.callTool({ name: 'web_search', arguments: { query: '' } }).catch((e) => ({ threw: e.code, msg: e.message }));
console.log('bad args ->', JSON.stringify(bad).slice(0, 240));
const unk = await mcp.callTool({ name: 'nope', arguments: {} }).catch((e) => ({ threw: e.code, msg: e.message }));
console.log('unknown tool ->', JSON.stringify(unk).slice(0, 200));
await mcp.close();
