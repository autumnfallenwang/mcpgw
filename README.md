# mcpgw

The home cluster's tool gateway. **Models live in [llmgw](https://github.com/autumnfallenwang/llm-gateway), tools live
here, loops live in apps.**

Models only know what was in their training data. mcpgw gives home apps such as
[homestorm](https://github.com/autumnfallenwang/homestorm) one place to reach tools: `web_search` and `web_fetch` first, more later.

**Status:** live on the home k3s cluster at http://mcpgw.mcpgw.svc.cluster.local, with `web_search` and `web_fetch`. Only
home apps call it. See [the plan](docs/plan.md).

## How it works, in short

- **Tools over MCP:** one stateless service at `POST /mcp`, serving the current MCP protocol and the 2025 one that
  Codex still uses.
- **It runs tools and nothing else:** mcpgw never calls an LLM and never runs an agent loop. Each app decides when a
  model may use a tool and who sees the results.
- **Search:** a self-hosted SearXNG that only mcpgw talks to, behind a provider layer that a hosted API could replace.
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

## Deploy

GHCR image, the Helm chart in `deploy/chart`, and an Argo CD Application in `arch-infra` (`apps/mcpgw.yaml`; review copy in
`deploy/arch-infra/`), like the sibling apps.

- **CI** (`.github/workflows/build.yml`): lint, types and tests, then the image tagged with the commit SHA, then the tag
  bumped in arch-infra. The bump needs an `ARCH_INFRA_TOKEN` repo secret; without it the job skips with a warning and the
  tag is bumped by hand.
- **Logs:** `{namespace="mcpgw"} | json | event="tool.call"`. One request: `| json | req_id="<id>"`.
- **Check it's healthy, from arch:** 
  `curl http://$(kubectl -n mcpgw get svc mcpgw -o jsonpath='{.spec.clusterIP}')/health` shows the service and its search
  backend.

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
