# 0002: One tool gateway beside llmgw

- **Status:** accepted
- **Date:** 2026-11-04

## Context

Every model behind llmgw answers only from its training data. llmgw passes function tools through in OpenAI format
and doesn't run any. Something has to run them, and later tools (code, home data) will raise the stakes.

## Decision

**A separate service, mcpgw, runs tools.** The split:

| Part | Owner |
|---|---|
| Models: routing, logins, limits, usage | llmgw (unchanged) |
| Tools: the catalog and running each tool safely | mcpgw |
| When a model may use a tool, the tool loop, who sees the results | each app |

mcpgw never calls an LLM and never runs an agent loop.

## Alternatives considered

- **A standalone SearXNG that each app calls.** Rejected: every later tool becomes one more service and one more API.
- **Tools inside llmgw.** Rejected: llmgw holds the Claude and GPT logins and serves every app. A slow fetch or a
  crashing tool must not take model access down with it, and a code sandbox must never share a process with those
  credentials.
- **The tool loop inside mcpgw** (an agent service). Rejected: apps need to decide who may use tools, how many calls a
  turn gets and who sees the results. homestorm's [ADR 0014](https://github.com/autumnfallenwang/homestorm/blob/main/docs/adr/0014-tools-through-mcpgw.md)
  makes that call for meetings.
- **A proxy product in front of existing MCP servers** (such as agentgateway, with off-the-shelf search and fetch
  servers). Rejected for v1: it answers a question we don't have yet, since there's only one server, and the safety
  rules on `web_fetch` are the part we most need to own.

## Consequences

- One tool catalog and one failure boundary. If mcpgw is down, apps lose tools and keep their models.
- Harnesses such as Claude Code and Codex get the same tools with no app code. They call mcpgw directly and don't go
  through llmgw.
- **The name is slightly loose.** In the industry an "MCP gateway" usually means a proxy in front of many MCP servers;
  v1 is one MCP server that holds its own tools. That's fine until a tool has to run elsewhere. `code_run` must, and
  its design note decides whether mcpgw proxies it or a product goes in front.
