# Harness check (2026-11-05)

Harnesses aren't connected to mcpgw now ([ADR 0010](../../docs/adr/0010-home-apps-only-for-now.md)). This stays as the record,
for if one is reconnected.

Throwaway scripts that tried real Claude Code and Codex against MCP SDK v2 before any of mcpgw was built. Several ADRs
cite these results. The canned prices are made up, so a model quoting one can only have got it from the tool.

- `server.mjs`: the SDK v2 mount from the docs, on `$BIND:3401`, with a request log. Guards and `/health` tests.
- `server2.mjs`: on `172.17.0.1:$PORT`, with `allowedOrigins` from `$ORIGINS` (JSON). `web_search` returns text plus
  `structuredContent` with different prices; `web_fetch` returns text only, with a different price in `_meta`.
- `client.mjs`: what an app writes with no REST mirror: v2 client, list, convert to OpenAI tools, call.

Run: `npm i @modelcontextprotocol/server@2.4.0 @modelcontextprotocol/hono@2.0.2 @modelcontextprotocol/client@2.4.0 hono
@hono/node-server zod@4.6.7`, then `BIND=172.17.0.1 node server.mjs` or `ORIGINS='[]' PORT=3402 node server2.mjs`.
`172.17.0.1` is the Docker bridge: a non-loopback address that isn't exposed to the LAN.

Point the harnesses at it without touching their configs:

```sh
claude -p "<prompt naming the tool>" --model haiku --strict-mcp-config --output-format stream-json --verbose \
  --mcp-config '{"mcpServers":{"mcpgwtest":{"type":"http","url":"http://172.17.0.1:3402/mcp"}}}' \
  --allowedTools mcp__mcpgwtest__web_search mcp__mcpgwtest__web_fetch --disallowedTools WebSearch,WebFetch
codex exec --skip-git-repo-check --ephemeral --sandbox read-only -m gpt-5.6-luna --json \
  -c 'mcp_servers.mcpgwtest.url="http://172.17.0.1:3402/mcp"' "<prompt naming the tool>"
```

## Results

Claude Code 2.1.318, Codex 0.166.0, `server` 2.4.0, `hono` 2.0.2, `client` 2.4.0.

**Protocol.** One endpoint served both harnesses:

| Harness | Requests | Protocol |
|---|---|---|
| Claude Code | `server/discover`, `subscriptions/listen`, `tools/list`, `tools/call` | `2026-07-28` |
| Codex | `initialize`, `notifications/initialized`, `tools/list`, `tools/call` | `2025-06-18` |

**Guards** (`allowedHosts` of `172.17.0.1` and `mcpgw.arch.internal`):

| Request | Status |
|---|---|
| Normal, and `Host: mcpgw.arch.internal` | 200 |
| `Host: mcpgw.mcpgw.svc.cluster.local:3002`, not on the list | 403 |
| `Host: evil.example` | 403 |
| `Origin: http://evil.example`, **no `allowedOrigins` set** | **200** |
| `Origin: http://evil.example`, `allowedOrigins: []` | 403 |
| No `Origin`, `allowedOrigins: []` | 200 |
| `Origin: http://homestorm.arch.internal`, with that value listed in `allowedOrigins` | 403 (not investigated) |
| `GET` and `DELETE /mcp` | 405 |
| `/health` on the MCP app, `Host: 10.42.0.5:3002` | 403 |
| `/health` on an outer app, same `Host` | 200 |

**What the model receives:**

| Result shape | Claude Code | Codex |
|---|---|---|
| Text + `structuredContent` | The JSON only (read from the delivered `tool_result`) | Both (from the model's answer) |
| Text only + `_meta` | The text; no `_meta` | The text; no `_meta` in the answer, though the client event has it |

**v2 client:** a bad argument came back as `isError: true` with a readable message, and an unknown tool threw `-32602`.
Tool schemas include a `$schema` key, so check that llmgw and all three families accept it (M5).

**Earlier, on SDK 1.32.2 with the repo's fake server:**

- Both harnesses worked over plain HTTP.
- `codex exec` refused the unannotated tool: "MCP tool call requires approval, but approval policy is never". Either
  `readOnlyHint: true` on the server or `tools.web_search.approval_mode="approve"` fixed it.
- Claude Code held a `GET /mcp` stream open for the whole session, and accepted a 405 there just as well.

**Not covered:** Traefik, the real hostname, a second device, interactive sessions, and which search a model picks
without being told. In every run the prompt named the tool, and Claude Code's built-ins were off.
