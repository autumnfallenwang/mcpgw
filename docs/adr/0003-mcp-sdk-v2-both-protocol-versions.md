# 0003: MCP SDK v2, serving both protocol versions

- **Status:** accepted
- **Date:** 2026-11-05

## Context

The first design assumed `@modelcontextprotocol/sdk` 1.x and the `initialize` handshake. Since then:

- **MCP `2026-07-28`** removed `initialize`, sessions and the `GET` stream, and added `server/discover`.
- **SDK v2** split into `@modelcontextprotocol/server`, `client` and framework adapters, including `hono`. It's the
  stable line. 1.x gets fixes for at least six months after v2's release on 2026-07-27, so until about January 2027.
- **The harnesses are on different versions.** In testing, Claude Code 2.1.318 spoke `2026-07-28`, and Codex 0.166.0
  sent `initialize` at `2025-06-18`.

The docs didn't say whether v2's recommended setup would work with today's Codex, so it was tested
([dev/harness-check/](../../dev/harness-check/)). Both harnesses called the tool on one endpoint.

## Decision

- Use `createMcpHandler` with its default `legacy: "stateless"`, which serves both protocol eras statelessly, mounted
  through `createMcpHonoApp`.
- Pin exact versions of the SDK packages (tested: `server` 2.4.0, `hono` 2.0.2, `client` 2.4.0).
- Set the guards explicitly: `allowedHosts` naming every host callers use, and `allowedOrigins: []`.
- Keep `/health` and `/` on an outer Hono app.

## Alternatives considered

- **Stay on 1.x.** It worked with both harnesses in testing, through Claude Code's fallback. Rejected: it serves only
  the old protocol, on a line whose guaranteed support ends soon.
- **`legacy: "reject"`** (new protocol only). Rejected: the spec's compatibility table says old clients then fail with
  a 400, and that would be Codex today.
- **Writing the JSON-RPC by hand.** Rejected: more code and more ways to break the spec, for no gain.

## Consequences

- `GET` and `DELETE` on `/mcp` answer 405 with no code of ours.
- **Three setup traps, all found in testing:** without `allowedOrigins`, a hostile `Origin` got a 200; a host not on
  `allowedHosts` gets a 403; `/health` on the MCP app refuses a pod-IP `Host`. Integration tests must cover all three.
- Claude Code opens a long-lived `subscriptions/listen` POST. Whether it survives Traefik is checked at M2.
- The package versions don't match each other, though the migration guide says v2 packages share one number. Upgrades
  need the harness check re-run.
- Once Codex moves to the new protocol, the legacy path could go. There's no hurry.
