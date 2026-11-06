# Tool-loop demo (2026-11-04)

A fake MCP server and a client that plays an app's part, run against the real llmgw before mcpgw existed.

- `fake-server.mjs`: an MCP server (Streamable HTTP, stateless) on `127.0.0.1:3399/mcp` with one `web_search` tool
  that returns a made-up gold price, $1,234.56 from `example.test`, so an answer quoting it can only have come from
  the tool.
- `app.mjs`: `tools/list` over MCP, converted to OpenAI `tools`, sent to llmgw; each `tool_calls` is run with
  `tools/call` and returned as a `role: "tool"` message, until the model answers.

Run: `npm i @modelcontextprotocol/sdk openai zod` (tested with SDK 1.32.2, openai 7.50.0, zod 4.6.7), then
`node fake-server.mjs &` and `node app.mjs`.

Result: Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek Flash each searched for the gold price (each wrote its own
query) and quoted $1,234.56; none searched for "Who wrote Hamlet?". Claude flagged the test feed as implausible,
DeepSeek suggested cross-checking, GPT stated it as fact. Non-streaming calls only; streaming tool calls are untested.

A good seed for mcpgw's MCP integration test and for homestorm's fake MCP server in its engine tests.
