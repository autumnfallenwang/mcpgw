# Upkeep

About once a month, or when search seems worse. mcpgw depends on things that change without telling it: search engines that start
or stop refusing the home IP, the MCP spec and SDK, and SearXNG's engine code. Log each pass in [progress.md](progress.md).

**A reminder comes by itself.** On the 7th of each month, the [upkeep workflow](../.github/workflows/upkeep.yml) opens an issue
with sections 1 and 2 already checked, from [dev/upkeep/report.mjs](../dev/upkeep/report.mjs), and a checklist for the steps that
need arch. Run the script yourself for the same report at any time.

## 1. Versions

```sh
for p in @modelcontextprotocol/server @modelcontextprotocol/hono @modelcontextprotocol/client hono @hono/node-server zod undici \
  unpdf @mozilla/readability linkedom turndown pino; do echo "$p $(npm view $p version)"; done
gh api repos/modelcontextprotocol/modelcontextprotocol/releases --jq '.[0:2][] | "\(.tag_name) \(.published_at[0:10])"'
```

- **The MCP SDK packages are pinned exactly** ([ADR 0003](adr/0003-mcp-sdk-v2-both-protocol-versions.md)). Read the changelog
  before moving them, and run `pnpm test`: `tests/mcp.test.ts` covers both protocol versions.
- **A new spec revision** means checking what a tools-only server must do, as for `2026-07-28`: `server/discover`, `resultType`,
  and the cache fields on `tools/list`.
- **Others:** take patch and minor updates, then run `pnpm lint && pnpm typecheck && pnpm test`.

## 2. SearXNG

The image is pinned in `deploy/chart/values.yaml` and the README. List the engine changes since the pinned commit:

```sh
gh api repos/searxng/searxng/compare/<pinned>...<newest> --jq '.commits[] | .commit.message | split("\n")[0]'
```

Move only for a fix to an engine in `settings.yml`. A move can change which engines answer, so benchmark it locally first, with the
new image in the `docker run` from the README.

## 3. Engines

- **On mcpgw's status page,** `/docs`: engines that failed in the last hour, and which are left out and until when.
- **In Grafana:** `{namespace="mcpgw"} | json | event="searxng.engine_paused"`, and the two alert rules in
  [deploy/observability/](../deploy/observability/alerting-rules.yaml).
- **An engine left out for days** is the time to change the mix ([ADR 0012](adr/0012-search-engine-mix.md)), or to reconsider the
  hosted fallback (plan D10). Score any new mix with the benchmark before changing it.

## 4. Benchmarks

Paced, from arch, never in a burst: an unpaced run drew CAPTCHAs and made everything look worse than it was. See
[dev/benchmark/](../dev/benchmark/README.md).

```sh
cd dev/benchmark
node retrieval.mjs --label upkeep-YYYY-MM   # the tools alone: no model, no allowance
node news.mjs --label upkeep-YYYY-MM        # a judge model scores news results
```

Compare with the last labels in `results/`. The answer test, `answers.mjs`, uses model allowance, so run it only when something
changed.

## 5. Real use

Read the last month's tool calls in Grafana, by client: which fail, which refuse, how long searches wait for their turn
(`duration_ms` on `web_search`), and which sites `web_fetch` can't read. Pages that came back with little text are
`{namespace="mcpgw"} | json | event="tool.call" | thin="true"`: only the host is logged, so try that site's pages to see
whether extraction dropped something, as it once dropped the version from Node.js's download page.
