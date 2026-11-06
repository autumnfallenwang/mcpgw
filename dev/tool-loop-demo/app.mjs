// Plays homestorm's part: MCP tools/list → llmgw tools → run tool_calls on the MCP server → loop.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";

const llm = new OpenAI({ baseURL: "http://llmgw.arch.internal/v1", apiKey: "unused", maxRetries: 0 });
const mcp = new Client({ name: "homestorm-demo", version: "0.0.1" });
await mcp.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3399/mcp")));

// 1. Ask the MCP server what tools exist, and turn them into OpenAI-format tools for llmgw.
const { tools } = await mcp.listTools();
const openaiTools = tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));
console.log(`[app] MCP offers: ${tools.map((t) => t.name).join(", ")}`);

const SYSTEM = "You are a helpful assistant. Today is 2026-11-04. Your training data is older than today. Answer in one or two sentences.";

async function ask(model, question) {
  console.log(`\n=== ${model} · "${question}"`);
  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: question }];
  for (let step = 1; step <= 4; step++) {
    // 2. Send the conversation plus the tool list. The model decides: answer, or ask for a tool.
    const r = await llm.chat.completions.create({ model, messages, tools: openaiTools, max_tokens: 4096 });
    const msg = r.choices[0].message;
    if (!msg.tool_calls?.length) {
      console.log(`[model] answers (finish=${r.choices[0].finish_reason}): ${msg.content?.trim()}`);
      return;
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      console.log(`[model] asks for tool: ${call.function.name}(${call.function.arguments})`);
      // 3. The app runs the call on the MCP server, then hands the result back as a "tool" message.
      const result = await mcp.callTool({ name: call.function.name, arguments: JSON.parse(call.function.arguments) });
      const text = result.content.map((c) => c.text ?? "").join("\n");
      console.log(`[app] ran it on the MCP server, ${text.length} chars back`);
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }
  console.log("[app] stopped: too many tool steps");
}

for (const model of ["claude-haiku-5-5", "gpt-5.6-luna", "deepseek-flash"]) {
  await ask(model, "Check for me: what's the current price of gold?");
  await ask(model, "Who wrote Hamlet?");
}
await mcp.close();
