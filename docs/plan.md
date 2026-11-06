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
- **Callers:** homestorm from inside the cluster; Claude Code and Codex on arch. Nothing else can reach it.
- **Tracing:** JSON logs in Loki for every request and tool call, with the caller's name and request ID.
- **Deploy:** k3s through Argo CD and arch-infra, at `http://mcpgw.mcpgw.svc.cluster.local`.

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
| D8 | Only arch and the cluster can reach mcpgw and llmgw; no auth | decided by the user: [ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md) |
| D9 | Search behind a replaceable provider; SearXNG first | decided: [ADR 0009](adr/0009-search-behind-a-replaceable-provider.md) |
| D10 | Hosted search fallback? | **not now:** the M3 trial found results for all 21 queries, so nothing justifies paying yet. Bing carries most of it, and weak spots are on the record ([progress.md](progress.md)). The provider layer makes it a small change later ([ADR 0009](adr/0009-search-behind-a-replaceable-provider.md)) |
| D12 | Should harnesses use mcpgw for search by default? | **the user's call. Recommended: no.** Keep the built-ins as the default, and name mcpgw when wanted. With `web_fetch` not approved, mcpgw's answers were weaker: Codex ran 16 searches and said 18.4 where its built-in said 18.6, and Claude Code couldn't confirm a version |
| D11 | PDF in v1 or later? | **later:** v1 refuses PDFs with a clear message. Parsing them needs a heavy library and adds attack surface, and no finish line depends on it |

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

### M2: Deployed skeleton ✅

- [x] pnpm project: Hono, pino, zod 4, Vitest, Biome, `tsc`
- [x] `/health` and `/` on the outer app, and JSON logs in the house shape
- [x] `/mcp` on SDK v2 with the Host and Origin settings, and `web_search` returning canned results
- [x] Tests: both protocol versions, `_meta` reaching the v2 client, wrong `Host` 403, any `Origin` 403, `GET` and
  `DELETE` 405, `/health` 200 with a pod-IP `Host`
- [x] Dockerfile, Helm chart, CI, `apps/mcpgw.yaml` in arch-infra
- [x] **By the user:** DNS name `mcpgw.arch.internal` on the router
- [x] **At the real hostname through Traefik:**
  - Claude Code and Codex both call the tool from this machine;
  - a `subscriptions/listen` stream, replayed from what Claude Code really sends, held for 330 s until the test ended
    it, with the SDK's keepalive every 15 s;
  - a call to the in-cluster address from a pod works;
  - Kubernetes probes pass, and Loki shows only JSON.
- ~~The same from a second device:~~ no longer applies, since other devices can't reach it (M7)

### M3: `web_search` ✅

- [x] `SearchProvider` interface and the SearXNG implementation; local SearXNG container for dev
- [x] Text and `_meta` output, cache, concurrency limit, errors that say what to do next
- [x] SearXNG in the chart (no ingress), ConfigMap, pinned image. No Secret: the pod generates its own key at boot
- [x] Unit and fake-SearXNG integration tests
- [x] **Finish line:** 21 real queries from the home IP (news, docs, prices, non-English), reviewed with the engine
  errors, and D10 decided

### M4: `web_fetch` ✅

- [x] The §6.1 checks and their test table first, before any page-reading code
- [x] Redirects, size and time limits, concurrency limit, URL length limit
- [x] Extraction, output cleaning, `Accept: text/markdown`; Readability and Defuddle compared on real pages (Readability
  stays); D11 decided
- [x] Page parsing moved into capped workers, after a hostile page froze the main thread in testing
- [x] NetworkPolicies for both Deployments
- [x] **Finish line, on the cluster:** a real page reads cleanly; a private URL is refused with a clear reason; from
  inside the pod, with the app's checks out of the way, the LAN, llmgw and the service network are refused, while a pod
  with no policy reaches them

### M5: homestorm uses it ✅ (M9 in homestorm's plan, in its own repo)

- [x] Streaming `tool_calls` through llmgw checked on all three families with thinking on, including SDK v2's schemas
  with `$schema`. This changed the design: see the progress log
- [x] Today's date in the intro
- [x] homestorm's ADR 0014 and plan updated
- [x] `@modelcontextprotocol/client` in homestorm's API
- [x] Chair search, posted as one message every seat reads
- [x] Seat tools: the tool loop with a limit of 4 calls per turn, and the URL rule from
  [ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md)
- [x] **Finish line:** a real meeting in a real browser on localhost, against the real llmgw and mcpgw: seats on all three
  families searched, read pages and cited them; a `web_fetch` of a URL from no allowed source was refused before reaching
  mcpgw
- [x] On the cluster: deployed, migrated with the data intact, and homestorm's real client reaches mcpgw from its pod
- [ ] **By the user:** a real meeting on the cluster, which needs the admin login

### M6: Harnesses use it 🔄

- [x] mcpgw added to Claude Code and Codex at user level, and both connect
- [x] Codex: `approval_mode = "prompt"` on `web_fetch`. It asks in an interactive session, and refuses unattended
- [ ] **By the user:** the same rule for Claude Code. Auto mode won't let me change Claude Code's permission rules, and in
  `auto` mode the classifier otherwise approves `web_fetch` by itself. The command is in the README. Tested per-run: with
  the rule, `web_fetch` is denied unattended
- [x] Which search each model picks without being told: the built-in one, every time (4 of 4)
- [x] What it takes to change that: one instruction works on both. Turning the built-in off works on Claude Code, while
  Codex falls back to another hosted search
- [x] Services table in arch-infra's README
- [ ] **By the user:** D12. The original finish line, "a normal coding session uses mcpgw for search", isn't met by default,
  and the evidence argues against forcing it

### M7: Only arch and the cluster 🔄

Decided by the user in [ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md), replacing LAN access.

- [x] homecal, homenews and homestorm use `llmgw.llmgw.svc.cluster.local`
- [x] llmgw 0.7.0: refuses other Host names and other sites' web pages, and open CORS is gone
- [x] **By the user:** `/etc/hosts` on arch points both full names at their Service IPs
- [x] Claude Code, Codex and local `.env` files use the full names
- [x] Both Ingresses removed, both Service IPs pinned, and the old names refused
- [x] **Finish line:** `http://llmgw.llmgw.svc.cluster.local/docs` works in a real browser on arch, and Traefik answers 404 for
  the old names. Tested from arch, sending the Host header a device on the network would send
- [ ] **By the user:** remove `llmgw.arch.internal` and `mcpgw.arch.internal` from the router's DNS
- [ ] **By the user:** install the firewall rule ([deploy/host/](../deploy/host/)), and decide whether it also blocks Ollama

v1 is done after the remaining "by the user" items.

## Future work

Each needs its own design note first ([design §2](design.md)):

- **`code_run`:** its own process and sandbox. That's also when to decide how mcpgw reaches tools running elsewhere:
  proxy them itself, or put a product such as agentgateway in front.
- **`docs_search`,** then **read-only home data.**
- **Bearer tokens,** before any untrusted device or wider exposure.
