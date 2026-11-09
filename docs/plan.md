# Plan

What the first workable version of mcpgw includes, the milestones to get there, and the decisions still open.
Progress against this plan is logged in [progress.md](progress.md). The design is in [design.md](design.md).

**Updated:** 2026-11-09

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

`code_run`, `docs_search`, read-only home data, bearer tokens, a REST mirror and federating other MCP servers. Rendering
JavaScript pages and public exposure aren't planned at all ([design §2](design.md)).

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
| D10 | Hosted search fallback? | **not now:** M9 measured mcpgw at least level with Claude Code's own search, so nothing justifies paying yet. It's the fallback if the engines degrade |
| D12 | Should harnesses use mcpgw? | **no, for now: the user's decision.** Only home apps call it: [ADR 0010](adr/0010-home-apps-only-for-now.md) |
| D11 | PDF in v1 or later? | **now:** a measured gap, read in capped workers: [ADR 0011](adr/0011-read-pdfs-in-capped-workers.md) |
| D13 | Keep SearXNG as the search backend? | **yes:** measured against Claude Code's own search in M9, and nothing open source and self-hosted beat it. The engine mix is [ADR 0012](adr/0012-search-engine-mix.md) |
| D14 | Can the M9 benchmark run Claude against mcpgw? | **yes:** taken from the user's "go M9 e2e". One question at a time, with no change to Claude's config, so [ADR 0010](adr/0010-home-apps-only-for-now.md) stands |

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
- [x] **A real meeting on the cluster,** with the user signed in: run on 2026-11-07, and again after the fixes in M10

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

### M9: Tool quality ✅

Started with the user's "go M9 e2e" on 2026-11-06. How it's measured, and its limits, is in [dev/benchmark/](../dev/benchmark/).

**Answers,** 32 questions run twice on Claude Haiku and once on GPT-5.6 Luna, graded blind. Scores run from -50 to 100:

| Setup | Score | Right | Wrong | Median time |
|---|---|---|---|---|
| Claude, no tools (the control) | 29.7 | 9 of 32 | 0 | 3 s |
| Claude, its own search | 93 | 59 of 64 | 1 | 12 s |
| Claude, mcpgw before | 97.7 | 62 of 64 | 0 | 6 s |
| **Claude, mcpgw after steps 1 to 4** | **99.2** | **63 of 64** | **0** | **5 s** |
| GPT, mcpgw before | 78.1 | 26 of 32 | 3 | 20 s |
| **GPT, mcpgw after steps 1 to 4** | **90.6** | **30 of 32** | **2** | **16 s** |

On 8 harder questions, too recent for a model to know, every setup with tools scored 100, and no tools scored 25. The gap to Claude's
own search is a few questions, so read it as "at least level with it", not as proof that mcpgw is better.

**Tools alone:**

| Measure | Before | After steps 1 to 4 | Target |
|---|---|---|---|
| Search results on the topic | 83% | 96% | At least 90%: met |
| First result on the topic | 25 of 31 | 30 of 31 | |
| `site:` searches on the topic | 0 of 15 | 15 of 15 | |
| Empty searches, GPT | 12 of 63 | 3 of 50 | Under 5%: 6% for GPT, 2% with Claude's included |
| Failed fetches, Claude | 13 of 88 | 4 of 66 | |
| PDFs read | 0 of 3 | 3 of 3 | |
| Pages with usable text | 23 of 36 | 26 of 36 | At least 75%: **72%, missed** |
| Share of text that's link addresses | 20% | 0% | |

The 10 pages still unusable refuse mcpgw (6) or need JavaScript (4), and neither is planned to change.

"After" ran the new image and engine mix in local containers, because auto mode blocked the deploy at the time. The engine mix alone was
also measured on the cluster: 83% to 94% on the topic. The first test, on 2026-11-05, scored 61% because it was unpaced and drew CAPTCHAs,
so its numbers were replaced by these.

**On production,** after the deploy, the tools-alone test scored 98% on the topic (152 of 155), 31 of 31 first results, 15 of 15 `site:`,
3 of 3 PDFs and 26 of 36 pages, with 0% link addresses. That's level with the local run, since 96% to 98% is within one run's noise.
DuckDuckGo drew 3 CAPTCHAs during it, and the score held. The answer scores above weren't re-run on production.

- [x] **Step 0, benchmark:** [dev/benchmark/](../dev/benchmark/), with the baseline recorded
- [x] **Step 1, engines:** Yahoo and DuckDuckGo lead, Bing is a backup and Brave goes ([ADR 0012](adr/0012-search-engine-mix.md)). **Live**
- [x] **Step 2, honest search:** one more try for an empty result, which is never cached; narrow categories widen when they find too
  little; `site:` is applied by mcpgw too; Chinese, Japanese and Korean queries ask for their own language. **Live**
- [x] **Step 3, cleaner fetch:** link addresses are left out unless `include_links` asks for them. **Live**
- [x] **Step 4, PDFs:** read in capped workers, with a limit on the whole process's memory after a small PDF proved it could take the
  pod down ([ADR 0011](adr/0011-read-pdfs-in-capped-workers.md)). **Live**
- [x] **Step 5, decide:** no re-ranking and no hosted fallback, since the targets that matter are met without them
- [x] **Deployed on the user's OK** as image `f6e747a`. Confirmed with the tools-alone test on the cluster and from homestorm's pod: a
  search, a PDF and a normal page worked, and a private address was refused

**Not planned:**
- **JavaScript rendering:** it means running a heavy browser for a few pages, and Anthropic's own fetch tool doesn't do it.
- **Disguising fetches as a browser:** sites that refuse mcpgw stay refused. Where one offers an official API, such as the npm
  registry, a model can use that instead.

### M10: First real use 🔄

The first real meeting on the cluster, 3 seats on all three model families over 2 rounds, worked end to end, including a PDF, a
site that refuses mcpgw and a refused cluster address. It also showed what the tests hadn't:

- [x] **Bursts:** one round sent 6 searches in 3 s, and DuckDuckGo answered with CAPTCHAs. Searches now run 2 s apart across all
  callers, and a burst waits rather than failing (design §5.1)
- [x] **News:** mostly off-topic, because a time range made SearXNG skip every news engine but Bing News. News sends no range now,
  and Brave News replaced DuckDuckGo News: 67% to 80% good results on a new judge-scored test
  ([ADR 0012](adr/0012-search-engine-mix.md))
- [x] **`tools/list`** says it may be kept for 5 minutes, rather than the SDK's 0
- [x] **In homestorm, on the user's request:** 6 web calls per turn instead of 4, since every answer used all 4, and links that stop
  at Chinese punctuation
- [x] **Deployed and retested:** the same meeting again, in which all three seats found real tech news and two read an article
The user chose the next steps on 2026-11-07: ship, official APIs, tune from real use, upkeep. Nothing else is planned yet.

- [x] **Engines that refuse are left out** for a while, doubling up to an hour, rather than asked on every search. Built and
  pushed, not deployed
- [x] **Stack Overflow and npm read through their official APIs** ([ADR 0013](adr/0013-read-refusing-sites-through-official-apis.md)):
  usable pages 26 to 28 of 36 in a local run, past the 75% target. Built and pushed, not deployed
- [x] **Upkeep, first pass** ([upkeep.md](upkeep.md)): everything current but hono, now 4.13.17. SearXNG stays pinned: nothing since
  touches an engine we use
- [x] **Deployed on the user's OK** as `20a3db6`, the same code as `cef7f54`, whose image CI never built
- [x] **Alerts in Grafana:** web search failing, and an engine that keeps refusing, from `deploy/observability/`. Nothing receives
  them yet
- [x] **Measured on the cluster:** news 85% good results, up from 67%; 28 of 36 pages usable; search 90% on the topic with
  DuckDuckGo out; median search 0.5 s
- [x] **First tuning from real use:** only timeouts now count toward leaving an engine out, since Wikipedia's HTTP 400s on odd
  queries had it left out in a meeting. Deployed as `4d0c581` on the user's go
- [x] **DuckDuckGo through duckduckgo.com,** on the user's go on 2026-11-09: SearXNG's `duckduckgo web` engine in place of
  `duckduckgo`, whose html.duckduckgo.com still answered CAPTCHA. Every mix tried scored 97%, and this one was the only one with no
  engine refusing ([ADR 0012](adr/0012-search-engine-mix.md))
- [x] **Searches 1 s apart,** not 2: meeting-sized bursts at 1 s drew no refusals, and a round of 6 searches takes about 6 s
  instead of 11
- [x] **Dropdowns keep what they show:** Node.js's download page lost its version, the answer to a real question, because
  Readability removes buttons. Pages under 1,000 characters are logged as `thin` for upkeep to look at
- [x] **A push deploys only when the image changes:** docs and benchmark commits run the checks and stop, so they no longer
  restart the pod and forget which engines are left out
- [x] **Upkeep comes as an issue** on the 7th of each month, with what changed upstream already checked
  ([upkeep.md](upkeep.md))
- [ ] **Alerts reach someone:** waiting for the user to pick ntfy, Discord or email. It's a change in arch-infra
- [ ] **Keep tuning from real meetings.** Newegg refused 3 of the 4 failed fetches in the user's meetings on 2026-11-08 and 09, and
  has no public API, so it stays refused

## Future work

Each needs its own design note first ([design §2](design.md)):

- **`code_run`:** its own process and sandbox. That's also when to decide how mcpgw reaches tools running elsewhere:
  proxy them itself, or put a product such as agentgateway in front.
- **`docs_search`,** then **read-only home data.**
- **Bearer tokens,** before any untrusted device or wider exposure.
