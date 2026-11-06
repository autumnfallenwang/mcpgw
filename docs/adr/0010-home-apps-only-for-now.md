# 0010: Only home apps call mcpgw, for now

- **Status:** accepted, the user's decision. It reverses M6, which connected Claude Code and Codex.
- **Date:** 2026-11-05

## Context

mcpgw was designed so any MCP harness on arch could use it, and M6 connected Claude Code and Codex. The user has decided
against that for now. M6's testing points the same way: both prefer their own search unless told otherwise, mcpgw's answers
were weaker when `web_fetch` wasn't approved, and connecting them means managing approval rules for sessions that can see
code and secrets.

## Decision

**Only home apps call mcpgw for now.** homestorm is the only one today, calling it inside the cluster.

- Claude Code and Codex have no mcpgw entry in their configs.
- `/etc/hosts` on arch has no line for mcpgw, so its name doesn't resolve there. llmgw's line stays.
- Local development of a home app runs with the web features off, since `MCPGW_URL` has nothing to reach.

## Alternatives considered

- **Keep them connected, with approval rules.** It works, but it's more to manage, for tools they rarely choose on their own.
- **A NetworkPolicy naming the allowed apps.** It would stop other pods, and it's cheap to add later. Kubernetes always allows
  traffic from a pod's own node, so it wouldn't stop programs on arch. Left out for now: nothing else in the cluster calls
  mcpgw.
- **A token for home apps.** The only way to refuse a program on arch that targets the Service IP on purpose, but it means
  managing a secret to stop something that isn't happening.

## Consequences

- **This is a choice about configuration, not a lock.** A program on arch that deliberately sends a request to the Service IP
  with the right `Host` still gets an answer, and so does any pod. Other devices can't ([ADR 0008](0008-only-arch-and-the-cluster-no-auth.md)).
- The harness part of [ADR 0007](0007-keeping-data-from-leaking-through-web-fetch.md) isn't in use. The URL rule in apps is.
- mcpgw still serves both MCP protocol versions and keeps its tool annotations. Removing them would be work with no benefit.
- **To reconnect a harness later:** pin the Service IP in the chart, point the name at it in `/etc/hosts`, add mcpgw to the
  harness, and apply the approval rules in ADR 0007. The test results are in [dev/harness-check/](../../dev/harness-check/).
