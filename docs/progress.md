# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-05

- **Repo created, private for now:** `autumnfallenwang/mcpgw`, with README, plan, this log, ADRs 0001–0009, the updated
  design and the test scripts under `dev/`. It's plain Markdown docs only for now: no code, no devkit scaffold. Auto
  mode refused to create a public repo, so making it public is the user's step, and the last item in M1. It should
  happen before M2, because the cluster pulls images anonymously and GHCR images inherit the repo's visibility.
- **Three choices taken on the recommended side, not yet confirmed.** The user said to go ahead without picking
  between them, so the docs use the recommended option, and each is easy to change:
  - no REST mirror in v1 ([ADR 0005](adr/0005-mcp-only-no-rest-mirror.md));
  - `web_fetch` asks each time in harnesses
    ([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md));
  - no auth on the home network ([ADR 0008](adr/0008-home-network-only-no-auth.md)). This one assumes only trusted
    devices share the network, which the user still needs to confirm.
- **Design corrected** after checking it against MCP `2026-07-28`, SDK v2, OWASP and vendor docs. The architecture
  held; the protocol details were a generation behind.
  - SDK: `@modelcontextprotocol/sdk` 1.x replaced by the v2 packages
    ([ADR 0003](adr/0003-mcp-sdk-v2-both-protocol-versions.md)).
  - Results: text plus `structuredContent` replaced by text plus `_meta`
    ([ADR 0004](adr/0004-text-results-app-data-in-meta.md)).
  - Added: Host and Origin settings, tool annotations, fetch rate limit, URL length limit, output cleaning,
    `ipaddr.js` instead of hand-written IP checks, NetworkPolicies
    ([ADR 0006](adr/0006-web-fetch-cannot-reach-home-network.md)), and the rule against data leaks
    ([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md)).
  - Fixed: the two sections that disagreed on whether "no results" is an error (it isn't), the Claude Desktop claim
    (custom connectors connect from Anthropic's cloud), `--scope user` on the Claude Code command, and the Service
    port (80, like llmgw).
  - Build order: the skeleton now deploys first ([plan.md](plan.md)).
- **SDK v2 tried with real harnesses** ([dev/harness-check/](../dev/harness-check/)). `server` 2.4.0, `hono` 2.0.2,
  `client` 2.4.0, Claude Code 2.1.318, Codex 0.166.0.
  - One endpoint served Claude Code at `2026-07-28` and Codex at `2025-06-18`; both called the tool.
  - `GET` and `DELETE` on `/mcp` answer 405 with no code of ours. Claude Code sends no `GET` on the new protocol; it
    sends a `subscriptions/listen` POST instead.
  - **Three setup traps found:**
    - a hostile `Origin` got a 200 until `allowedOrigins: []` was set;
    - a name not in `allowedHosts`, such as the in-cluster one, gets a 403;
    - `/health` on the MCP app refuses a pod-IP `Host`, so it goes on an outer app.
  - A named origin (`http://homestorm.arch.internal`) was also refused. Not investigated, since nothing in a browser
    should call mcpgw.
- **What a model actually receives,** read from Claude Code's delivered `tool_result`, using a test tool whose text
  block and `structuredContent` carried different prices.
  - Claude Code delivered only the JSON and dropped the text block. Codex's model saw both.
  - A text-only result reached both unchanged. `_meta` reached neither model, and Codex's client event showed it
    arriving.
- **Claude Code and Codex first tried against SDK 1.32.2,** plain HTTP to a non-loopback address, no auth. Both
  connected and quoted the made-up price.
  - `codex exec` refused the tool: "MCP tool call requires approval, but approval policy is never". Both
    `readOnlyHint: true` on the server and `tools.web_search.approval_mode="approve"` on the client fixed it.
    `readOnlyHint` means Codex then runs the tool without asking, which is why `web_fetch` gets a client setting
    ([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md)).
  - Claude Code held a `GET /mcp` stream open for the whole session on the old protocol.
- **Network facts checked:**
  - the router's DNS answers each `.arch.internal` name individually, with no wildcard. `mcpgw.arch.internal` doesn't
    resolve yet;
  - this machine (`aaron-desktop-arch`, 192.168.1.163) is the k3s node, and has no VPN;
  - k3s runs with no flag disabling network policies, and `argocd` already has some. Enforcement isn't proven yet.
- **Not tested yet:** Traefik, the real hostname, a second device, and Codex's `approval_mode = "prompt"`. All are on
  the plan (M2 and M6).
- **Research limits, for later:**
  - evidence on SearXNG reliability is forums and vendor posts, with no independent benchmark;
  - a July report says Anthropic closed a `web_fetch` leak by no longer following links inside fetched pages, while
    its current docs still list fetch results as an allowed URL source. The strict rule was chosen either way.

## 2026-11-04

- **Design written** ([design.md](design.md)): a tool gateway beside llmgw, with `web_search` through SearXNG and
  `web_fetch`, over MCP.
- **Tool loop tried with a fake MCP server** against the real llmgw
  ([dev/tool-loop-demo/](../dev/tool-loop-demo/)). Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek Flash each chose to
  search for a price, wrote their own query and quoted the fake result. None searched for "Who wrote Hamlet?". Claude
  doubted the source, DeepSeek suggested cross-checking, and GPT stated it as fact, so sources must stay visible.
  Non-streaming calls only.
