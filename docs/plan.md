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
- **Callers:** home apps, from inside the cluster. Today that's homestorm ([ADR 0010](adr/0010-home-apps-only-for-now.md)).
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
| D7 | Apps limit which URLs may be fetched | decided: [ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md). Its harness rule isn't in use (D12) |
| D8 | Only arch and the cluster can reach mcpgw and llmgw; no auth | decided by the user: [ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md) |
| D9 | Search behind a replaceable provider; SearXNG first | decided: [ADR 0009](adr/0009-search-behind-a-replaceable-provider.md) |
| D10 | Hosted search fallback? | **not now:** the M3 trial found results for all 21 queries, so nothing justifies paying yet. Bing carries most of it, and weak spots are on the record ([progress.md](progress.md)). The provider layer makes it a small change later ([ADR 0009](adr/0009-search-behind-a-replaceable-provider.md)) **Up for review in M9:** that trial counted whether results came back, not whether they were any good. |
| D12 | Should harnesses use mcpgw? | **no, for now: the user's decision.** Only home apps call it: [ADR 0010](adr/0010-home-apps-only-for-now.md) |
| D11 | PDF in v1 or later? | **later:** v1 refuses PDFs with a clear message. Parsing them needs a heavy library and adds attack surface, and no finish line depends on it **Up for review in M9, step 4.** |
| D13 | Keep SearXNG as the search backend? | **yes for now, until the benchmark says otherwise:** nothing open source and self-hosted beat it in the 2026-11-06 research. It has no index of its own, so its quality depends on which engines tolerate it |
| D14 | Can the M9 benchmark run Claude against mcpgw? | **open, the user's call.** An exception to [ADR 0010](adr/0010-home-apps-only-for-now.md): one question at a time, with no change to Claude's config |

When a decision is made, record it as an ADR in [adr/](adr/), update this table, and log it in
[progress.md](progress.md).

---

## Milestones

Status: ✅ done · 🔄 in progress · ⬜ not started · ↩️ reverted

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

### M6: Harnesses use it ↩️

Built and tested, then removed by the user's decision: only home apps call mcpgw for now
([ADR 0010](adr/0010-home-apps-only-for-now.md)). What it found is in the progress log, for if it's ever wanted again.

- [x] Connected Claude Code and Codex, and tested them through Traefik and at the full name
- [x] Tested `web_fetch` approval: Codex's `approval_mode = "prompt"` asks, and Claude Code needs an `ask` rule in `auto` mode
- [x] Tested which search they pick: their built-in one, 4 of 4
- [x] Removed mcpgw from both
- [x] Services table in arch-infra's README

### M7: Only arch and the cluster 🔄

Decided by the user in [ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md), replacing LAN access.

- [x] homecal, homenews and homestorm use `llmgw.llmgw.svc.cluster.local`
- [x] llmgw 0.7.0: refuses other Host names and other sites' web pages, and open CORS is gone
- [x] **By the user:** `/etc/hosts` on arch points both full names at their Service IPs
- [x] Local `.env` files use the full names
- [x] Both Ingresses removed, both Service IPs pinned, and the old names refused
- [x] **Finish line:** `http://llmgw.llmgw.svc.cluster.local/docs` works in a real browser on arch, a page from another site is
  refused, and Traefik answers 404 for the old names. Tested from arch, sending the Host header a device on the network
  would send
- [x] **By the user:** removed `llmgw.arch.internal` and `mcpgw.arch.internal` from the router's DNS. The router now answers that they don't exist
- [x] **By the user:** installed the firewall rule ([deploy/host/](../deploy/host/)), which also blocks Ollama from other devices.
  llmgw's Ollama calls still work

### M8: Status page ✅

- [x] Read-only page at `/docs` ([design §4.2](design.md)), checked in a real browser against the real SearXNG
- [x] mcpgw and homestorm added to Grafana's "Home apps — HTTP overview" dashboard
- [x] Deployed, and checked in a browser on arch

v1 is done after the remaining "by the user" items.

### M9: Tool quality ⬜

Planned with the user on 2026-11-06, to start later. Measure first, then change one thing at a time and measure again.

First measurements, from the live tools on 2026-11-06. They came from a one-off test, not yet from the benchmark in step 0:

| Measure | Today | Target |
|---|---|---|
| Search results on the topic | 61% of the top 5 | At least 90% |
| First search result on the topic | 14 of 30 | |
| Chinese and `site:` searches on the topic | 0 of 15, and 0 of 10 | |
| Searches that came back empty, in a model test | 8 of 29 | Under 5% |
| Pages with usable text | 23 of 35 | At least 75% |
| Model answers right, GPT-5.6 Luna | 9 of 15, with 3 partial | Within about 10 points of Claude's |

The targets are proposals. "On the topic" only means a result mentions the query's subject, not that it's correct, which is
one reason step 0 comes first. The search numbers are probably somewhat worse than normal use, because the testing itself
drew CAPTCHAs from the engines, all from one home IP.

- [ ] **Step 0, benchmark:** `dev/benchmark/` in this repo, so any change can be measured the same way
  - Same Claude model and questions, with only the tools changing: Claude Code's WebSearch and WebFetch as the baseline,
    mcpgw today, and mcpgw after each step. It needs D14
  - About 50 questions, run at least twice: fresh facts with answers pulled live from each project's own data, dated facts
    with hand-checked answers, then documents, PDFs, Chinese, and sites that block us. Start with 30 on a cheaper model
  - Answers are graded right, partial or wrong without knowing which setup produced them, and a confident wrong answer counts
    worse than "I couldn't confirm". It also records empty searches, fetch success, tool calls and time
  - It's paced to protect the home IP, and the Claude runs need weekly allowance to spare
  - Limits: this measures Claude Code's search, not the API's tool, which needs a paid key. Claude Code's WebFetch may also
    summarize pages before the model sees them, so fetching isn't a pure like-for-like
- [ ] **Step 1, engines:** add Yahoo, drop Brave and re-check Bing, in the chart's SearXNG settings
  - Yahoo alone scored 98% on the topic against 57% on the same 25 queries, with the first result on the topic 25 of 25
    against 10 of 25, and Chinese and `site:` worked. That's one day from one IP, so it needs a backup engine
  - Brave is nearly always rate-limited here. Google, Qwant, Startpage, Mojeek, Baidu and Sogou were blocked or failing too
- [ ] **Step 2, honest search:** separate "nothing found" from "engines failed", retry once, and send Chinese queries with
  a suitable language setting
- [ ] **Step 3, cleaner fetch:** remove link addresses from page text. They take a median 23% of what's returned and up to
  78% on Chinese pages, and homestorm refuses to follow them anyway ([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md))
- [ ] **Step 4, PDFs:** read them in the existing limited workers. This reopens D11, so weigh the library's size and attack
  surface against the gap: forms and papers are often PDFs
- [ ] **Step 5, decide:** compare with Claude's baseline, and only add these if the numbers call for them
  - Re-ranking: 86% to 98% in a simulation on 12 queries, and mostly useful if Bing stays
  - A hosted search fallback when SearXNG comes back empty (D10), with Brave the first candidate on price. It needs no change
    for callers ([ADR 0009](adr/0009-search-behind-a-replaceable-provider.md)), but queries would also go to that vendor

**Deploying:** step 1 goes live on push, because Argo syncs the chart. Steps 2 to 4 need the image tag bumped in arch-infra, so
ask first each time ([CLAUDE.md](../CLAUDE.md)).

**Not planned:**
- **JavaScript rendering:** it means running a heavy browser for a few pages, and Anthropic's own fetch tool doesn't do it.
- **Disguising fetches as a browser:** sites that refuse mcpgw stay refused. Where one offers an official API, such as the npm
  registry, a model can use that instead.

## Future work

Each needs its own design note first ([design §2](design.md)):

- **`code_run`:** its own process and sandbox. That's also when to decide how mcpgw reaches tools running elsewhere:
  proxy them itself, or put a product such as agentgateway in front.
- **`docs_search`,** then **read-only home data.**
- **Bearer tokens,** before any untrusted device or wider exposure.
