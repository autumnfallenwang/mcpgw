# mcpgw

The home cluster's tool gateway. **Models live in [llmgw](https://github.com/autumnfallenwang/llm-gateway), tools live
here, loops live in apps.**

Models only know what was in their training data. mcpgw gives home apps such as
[homestorm](https://github.com/autumnfallenwang/homestorm) one place to reach tools: `web_search`, `web_fetch` and `code_run`.

**Status:** live on the home k3s cluster at http://mcpgw.mcpgw.svc.cluster.local, with `web_search` and `web_fetch`.
`code_run` is built and on its way (M11). Only home apps call it. See [the plan](docs/plan.md).

## How it works, in short

- **Tools over MCP:** one stateless service at `POST /mcp`, serving the current MCP protocol and the 2025 one that
  Codex still uses.
- **It runs tools and nothing else:** mcpgw never calls an LLM and never runs an agent loop. Each app decides when a
  model may use a tool and who sees the results.
- **Search:** a self-hosted SearXNG that only mcpgw talks to, behind a provider layer that a hosted API could replace.
- **Code:** `code_run` runs Python (Pyodide) in its own pod, each run a fresh Deno process allowed only to read Pyodide, and
  the pod can reach nothing ([ADR 0014](docs/adr/0014-run-python-in-pyodide-under-deno.md)).
- **Fetch:** `web_fetch` can't reach the home network. The app checks every address at connect time, and a
  NetworkPolicy blocks private addresses as a second layer.
- **Leaks:** a page can tell a model to send private data to an address it controls, and mcpgw can't tell where a URL
  came from. So apps limit which URLs may be fetched.
- **Only home apps call it, for now:** there's no Ingress, so other devices can't reach it, and harnesses aren't connected
  ([ADR 0010](docs/adr/0010-home-apps-only-for-now.md)).

## Develop locally

Needs Node 26, pnpm 10 and Docker.

```sh
pnpm install
docker run -d --name searxng-dev -p 127.0.0.1:8180:8080 -e SEARXNG_SECRET=dev \
  -v "$PWD/deploy/chart/files:/etc/searxng:ro" searxng/searxng:2026.11.5-3e95f6cd2
ALLOWED_HOSTS=127.0.0.1 SEARXNG_URL=http://127.0.0.1:8180 pnpm dev   # on :3002
```

- `pnpm test`: all tests, including hostile pages against the workers (about 10 s). No network or SearXNG needed.
- `pnpm lint`, `pnpm typecheck`.

**code_run's runner** needs Deno 2.9:

```sh
node code-runner/fetch-pyodide.mjs code-runner/pyodide      # Pyodide and its packages, each checked (39 MB)
deno test --allow-run --allow-read --allow-write=/proc --allow-env code-runner/   # the sandbox, about 45 s
deno run --allow-net=0.0.0.0:8080 --allow-run --allow-read --allow-write=/proc --allow-env code-runner/server.mjs
CODE_RUNNER_URL=http://127.0.0.1:8080 ALLOWED_HOSTS=127.0.0.1 SEARXNG_URL=http://127.0.0.1:8180 pnpm dev
```

## Deploy

GHCR image, the Helm chart in `deploy/chart`, and an Argo CD Application in `arch-infra` (`apps/mcpgw.yaml`; review copy in
`deploy/arch-infra/`), like the sibling apps.

- **CI** (`.github/workflows/build.yml`): lint, types, tests and the sandbox tests, then the images tagged with the commit SHA
  (the code runner's as `<sha>-code-runner`), then the tag
  bumped in arch-infra with the `ARCH_INFRA_TOKEN` repo secret (set since 2026-11-08, the token the other home apps use).
  Without it the job skips with a warning and the tag is bumped by hand. So a push to main is a deploy, but only when something
  an image holds changed (`src/`, `code-runner/`, the package files, the Dockerfiles or `build.yml`): docs and benchmark commits
  run the checks and stop there. The chart, `settings.yml` included, goes live through Argo CD on any push.
- **Upkeep** (`.github/workflows/upkeep.yml`): an issue on the 7th of each month, with what changed upstream and the checklist in
  [docs/upkeep.md](docs/upkeep.md).
- **Logs:** `{namespace="mcpgw"} | json | event="tool.call"`. One request: `| json | req_id="<id>"`.
- **Status page, in a browser on arch:** http://mcpgw.mcpgw.svc.cluster.local/docs shows the version, search health, failing
  engines, the tools and how to connect. `/health` and `/` return the basics as JSON.

## Who can use it

| Client | Works? | Why |
|---|---|---|
| Home apps (homestorm today) | **Yes** | They call `http://mcpgw.mcpgw.svc.cluster.local` from inside the cluster |
| Claude Code, Codex and other harnesses | **Not connected** | The user's decision for now ([ADR 0010](docs/adr/0010-home-apps-only-for-now.md), which also says how to reconnect one) |
| Anything on another device | **No** | There's no Ingress, and a firewall rule on arch drops anything routed in ([ADR 0008](docs/adr/0008-only-arch-and-the-cluster-no-auth.md)) |
| Cloud clients | **No** | They connect from the cloud |

## Docs

| Doc | What's in it |
|---|---|
| [docs/design.md](docs/design.md) | The design: interfaces, tools, safety rules, deployment, standards |
| [docs/plan.md](docs/plan.md) | First-version scope, milestones with status, decisions |
| [docs/progress.md](docs/progress.md) | Dated log of what was done and decided |
| [docs/adr/](docs/adr/) | Architecture decision records, one decision each |
| [dev/](dev/) | Throwaway test scripts that the decisions cite, each with its results |

Account-specific details stay in a local, gitignored `private/` folder.

## Decisions so far

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-house-stack.md) | Use the same stack and deployment as the other home apps |
| [0002](docs/adr/0002-tool-gateway-beside-llmgw.md) | One tool gateway beside llmgw: it runs tools, and never calls a model or runs a loop |
| [0003](docs/adr/0003-mcp-sdk-v2-both-protocol-versions.md) | MCP SDK v2, serving the `2026-07-28` protocol and the 2025 one on one endpoint |
| [0004](docs/adr/0004-text-results-app-data-in-meta.md) | Tool results are text for the model, with app data in `_meta` |
| [0005](docs/adr/0005-mcp-only-no-rest-mirror.md) | MCP is the only tool interface in v1: no REST mirror |
| [0006](docs/adr/0006-web-fetch-cannot-reach-home-network.md) | `web_fetch` can't reach the home network: connect-time checks plus a NetworkPolicy |
| [0007](docs/adr/0007-keeping-data-from-leaking-through-web-fetch.md) | Apps limit which URLs may be fetched; a harness would have to ask before each fetch |
| [0008](docs/adr/0008-only-arch-and-the-cluster-no-auth.md) | Only arch and the cluster can reach mcpgw and llmgw; no auth |
| [0009](docs/adr/0009-search-behind-a-replaceable-provider.md) | Search sits behind a replaceable provider; SearXNG first |
| [0010](docs/adr/0010-home-apps-only-for-now.md) | Only home apps call mcpgw, for now; harnesses aren't connected |
| [0011](docs/adr/0011-read-pdfs-in-capped-workers.md) | Read PDFs in capped workers, with a limit on the whole process |
| [0012](docs/adr/0012-search-engine-mix.md) | Yahoo and DuckDuckGo lead the search, with Bing as a backup |
| [0013](docs/adr/0013-read-refusing-sites-through-official-apis.md) | Read Stack Overflow and npm through their official APIs |
| [0014](docs/adr/0014-run-python-in-pyodide-under-deno.md) | Run model-written Python in Pyodide under Deno, in its own pod |
