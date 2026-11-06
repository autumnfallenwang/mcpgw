# 0005: MCP is the only tool interface in v1

- **Status:** accepted. The recommended option, taken when the user said to go ahead on 2026-11-05; not picked
  explicitly, and easy to change before M5.
- **Date:** 2026-11-05

## Context

The first design had a REST mirror beside MCP (`GET /v1/tools` in OpenAI format, `POST /v1/tools/{name}`), for apps
that didn't want an MCP client. Since then:

- the v2 client listed and called tools in a few lines
  ([dev/harness-check/client.mjs](../../dev/harness-check/client.mjs));
- every known caller is either TypeScript or an MCP harness.

## Decision

v1 has one tool interface: MCP at `POST /mcp`. Apps use `@modelcontextprotocol/client` and convert tools to OpenAI
format themselves. `/health` and `/` stay as plain HTTP.

## Alternatives considered

- **Keep the REST mirror as a thin adapter.** Its error codes are simpler and it's easy to `curl`. Rejected for now:
  it's a second surface to secure, test and document with no caller that needs it, and the conversion to OpenAI format
  belongs in the app, since llmgw is the app's concern.

## Consequences

- Fewer routes to guard, one set of errors, and no format conversion inside mcpgw.
- homestorm's ADR 0014 and plan still describe the REST mirror. They need updating in its repo (M5).
- Checking by hand needs an MCP client: the script in `dev/harness-check/` or the MCP Inspector, not plain `curl`.
- If a caller turns up that can't use an MCP client, add the mirror then.
