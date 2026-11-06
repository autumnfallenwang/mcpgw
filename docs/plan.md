# Plan

What the first workable version of mcpgw includes, the milestones to get there, and the decisions still open.
Progress against this plan is logged in [progress.md](progress.md). The design is in [design.md](design.md).

**Updated:** 2026-11-05

---

## First version (v1)

### In

- **Tools:** `web_search` through SearXNG behind a replaceable provider, and `web_fetch` with the safety rules in
  [design §6](design.md).
- **Interface:** MCP at `POST /mcp`, serving the `2026-07-28` protocol and the 2025 one Codex uses.
- **Callers:** homestorm from inside the cluster; Claude Code and Codex on the home network.
- **Tracing:** JSON logs in Loki for every request and tool call, with the caller's name and request ID.
- **Deploy:** k3s through Argo CD and arch-infra, at `http://mcpgw.arch.internal`.

### Out (later)

`code_run`, `docs_search`, read-only home data, bearer tokens, a REST mirror, federating other MCP servers, PDF if
it isn't trivial, rendering JavaScript pages, public exposure.

---

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Stack and deployment match the sibling apps | decided: [ADR 0001](adr/0001-house-stack.md) |
| D2 | One tool gateway beside llmgw; it runs tools and nothing else | decided: [ADR 0002](adr/0002-tool-gateway-beside-llmgw.md) |
| D3 | MCP SDK v2, serving both protocol versions | decided: [ADR 0003](adr/0003-mcp-sdk-v2-both-protocol-versions.md) |
| D4 | Tool results are text for the model, with app data in `_meta` | decided: [ADR 0004](adr/0004-text-results-app-data-in-meta.md) |
| D5 | MCP only: no REST mirror in v1 | **recommended option taken; the user hasn't picked it explicitly:** [ADR 0005](adr/0005-mcp-only-no-rest-mirror.md) |
| D6 | `web_fetch` can't reach the home network: connect-time checks plus a NetworkPolicy | decided: [ADR 0006](adr/0006-web-fetch-cannot-reach-home-network.md) |
| D7 | Apps limit which URLs may be fetched; harnesses ask before each fetch | **recommended option taken; the user hasn't picked it explicitly:** [ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md) |
| D8 | Home network only, no auth in v1 | **recommended option taken; the user needs to confirm the network is trusted:** [ADR 0008](adr/0008-home-network-only-no-auth.md) |
| D9 | Search behind a replaceable provider; SearXNG first | decided: [ADR 0009](adr/0009-search-behind-a-replaceable-provider.md) |
| D10 | Add a hosted search fallback? | open, decided from the M3 trial |
| D11 | PDF in v1 or later? | open, decided during M4 |

When a decision is made, record it as an ADR in [adr/](adr/), update this table, and log it in
[progress.md](progress.md).

---

## Milestones

Status: ✅ done · 🔄 in progress · ⬜ not started

The skeleton deploys at M2 rather than at the end, because the real network path is the one thing the tests so far
couldn't cover: Traefik, the real hostname, and a second device.

### M0: Research and design ✅

- [x] Design ([design.md](design.md))
- [x] Tool loop tried against the real llmgw with a fake MCP server
  ([dev/tool-loop-demo/](../dev/tool-loop-demo/))
- [x] Claude Code and Codex tried against SDK 1.32.2 and SDK v2, over plain HTTP with no auth
  ([dev/harness-check/](../dev/harness-check/))
- [x] Design checked against MCP `2026-07-28`, SDK v2, OWASP and vendor docs, then corrected

### M1: Repo and docs ✅

- [x] Public repo `autumnfallenwang/mcpgw`, like the sibling apps (made public by the user)
- [x] README, plan, progress, ADRs 0001–0009, `.gitignore`, `.dockerignore`

### M2: Deployed skeleton ⬜

- [ ] pnpm project: Hono, pino, zod 4, Vitest, Biome, `tsc`
- [ ] `/health` and `/` on the outer app, and JSON logs in the house shape
- [ ] `/mcp` on SDK v2 with the Host and Origin settings, and `web_search` returning canned results
- [ ] Tests: both protocol versions, `_meta` reaching the v2 client, wrong `Host` 403, any `Origin` 403, `GET` and
  `DELETE` 405, `/health` 200 with a pod-IP `Host`
- [ ] Dockerfile, Helm chart, CI, `apps/mcpgw.yaml` in arch-infra
- [ ] **By the user:** DNS name `mcpgw.arch.internal` on the router
- [ ] **Finish line, at the real hostname through Traefik:**
  - Claude Code and Codex both call the tool, from this machine and from a second device;
  - Claude Code's long-lived `subscriptions/listen` request survives while idle;
  - a call to the in-cluster address from a pod works;
  - Kubernetes probes pass, and Loki shows only JSON.

### M3: `web_search` ⬜

- [ ] `SearchProvider` interface and the SearXNG implementation; local SearXNG container for dev
- [ ] Text and `_meta` output, cache, concurrency limit, errors that say what to do next
- [ ] SearXNG in the chart (no ingress), ConfigMap, pinned image, Secret (**created by the user**)
- [ ] Unit and fake-SearXNG integration tests
- [ ] **Finish line:** about 20 real queries from the home IP (news, docs, prices, non-English), reviewed with the
  engine-error log, and D10 decided

### M4: `web_fetch` ⬜

- [ ] The §6.1 checks and their test table first, before any page-reading code
- [ ] Redirects, size and time limits, concurrency limit, URL length limit
- [ ] Extraction behind `extract()`, output cleaning, `Accept: text/markdown`; compare Readability and Defuddle on
  real pages; decide D11
- [ ] NetworkPolicies for both Deployments
- [ ] **Finish line, on the cluster:** a real page reads cleanly; a private URL is refused with a clear reason; from
  inside the pod, with the app's checks out of the way, the LAN, llmgw and the service network are unreachable

### M5: homestorm uses it ⬜ (M9 in homestorm's plan, in its own repo)

Two items don't need mcpgw and can start any time: **today's date in the intro**, and **checking streaming
`tool_calls` through llmgw**.

- [ ] Update homestorm's ADR 0014 and plan, which still describe the REST mirror
- [ ] `@modelcontextprotocol/client` in homestorm's API; check that llmgw and all three families accept the schemas
  SDK v2 produces, which include `$schema`
- [ ] Chair search, posted as one "Sources" message
- [ ] Seat tools: the tool loop with a per-turn limit, and the URL rule from
  [ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md)
- [ ] **Finish line:** a real meeting where a seat searches, reads a page and cites it; a `web_fetch` of a URL from
  no allowed source is refused

### M6: Harnesses use it ⬜

- [ ] Add mcpgw to Claude Code and Codex for real; `web_search` allowed, `web_fetch` asks each time
- [ ] Check that Codex's `approval_mode = "prompt"` asks in interactive sessions (only `approve` has been tested)
- [ ] See which search each model picks without being told; if it's always the built-in one, decide whether to turn
  the built-in off or add an instruction to `CLAUDE.md`
- [ ] Services table in arch-infra's README
- [ ] **Finish line:** a normal coding session on each harness uses mcpgw for search

v1 is done after M6.

## Future work

Each needs its own design note first ([design §2](design.md)):

- **`code_run`:** its own process and sandbox. That's also when to decide how mcpgw reaches tools running elsewhere:
  proxy them itself, or put a product such as agentgateway in front.
- **`docs_search`,** then **read-only home data.**
- **Bearer tokens,** before any untrusted device or wider exposure.
