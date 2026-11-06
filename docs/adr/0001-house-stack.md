# 0001: Same stack and deployment as the other home apps

- **Status:** accepted
- **Date:** 2026-11-05

## Context

mcpgw joins llmgw, homestorm and the other home apps on the k3s cluster. Those apps share one stack and one deployment
model. Matching them means one way of building, deploying and debugging everything, kept in one person's head.

## Decision

- **Language and repo:** TypeScript on Node, pnpm, a single package. It's one service, so no monorepo.
- **Server:** Hono + Zod 4, on `@hono/node-server`. MCP through the official SDK
  ([0003](0003-mcp-sdk-v2-both-protocol-versions.md)).
- **Quality:** Vitest for tests, Biome for lint and format, `tsc --noEmit` for type checks.
- **Logs:** pino, one JSON line per event in the house shape, collected into Loki.
- **Deploy:** images on GHCR, a Helm chart at `deploy/chart`, and GitOps through `arch-infra` and Argo CD.
- **Docs:** plain Markdown: README, `docs/plan.md`, `docs/progress.md`, ADRs. No devkit scaffold, hooks or project
  skills.

## Alternatives considered

- **Python with a framework such as FastMCP.** MCP and page extraction both have good Python libraries. Rejected:
  nothing here needs Python, and it would be the odd one out on the cluster.

## Consequences

- Patterns, deploy files and lessons from llmgw and homestorm carry over directly.
- Zod 4 is required by SDK v2. llmgw is already on it; homestorm's API is still on Zod 3.
