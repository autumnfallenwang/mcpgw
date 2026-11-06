# 0008: Home network only, no auth in v1

- **Status:** accepted. The recommended option, taken when the user said to go ahead on 2026-11-05. **It assumes only
  trusted devices share the home network, which the user hasn't confirmed.**
- **Date:** 2026-11-05

## Context

llmgw and the other internal services are reached through Traefik at `.arch.internal` names, with no auth. mcpgw could
do the same, but it's different in one way: `web_fetch` can send requests out through the home IP.

The MCP spec says servers *should* authenticate all connections and *must* apply proper access controls. It also
requires Origin validation, which stops web pages in a browser from calling a local server.

## Decision

- **No public exposure.** Reachable only at `mcpgw.arch.internal` on the home network, and from inside the cluster.
- **No auth in v1,** the same as llmgw, with the network boundary as the access control. This departs from the spec's
  *should*, knowingly.
- **Browser attacks are still blocked:** `allowedHosts` and `allowedOrigins: []`
  ([0003](0003-mcp-sdk-v2-both-protocol-versions.md)).
- **Add bearer tokens** before any of these: an untrusted device on the network, exposure beyond it, or a tool that
  reads private data. Use static tokens, not OAuth.

## Alternatives considered

- **A bearer token from day one.** About ten lines, and both harnesses support it (`--header` in Claude Code,
  `bearer_token_env_var` in Codex). Not chosen for v1 because nothing else on this network has one, but it's the right
  call now if the assumption above is wrong.
- **OAuth.** Rejected: too much for a home service, and Claude Code refuses to send OAuth credentials to a plain
  `http://` token endpoint on the local network.
- **A public HTTPS endpoint, so claude.ai and other cloud clients can connect.** Rejected: Anthropic's custom connectors
  connect from its cloud, so this would mean opening `web_fetch` to the internet to gain clients nobody needs yet.

## Consequences

- **Any device on the network can search and fetch through the home IP, anonymously.** That's the accepted risk.
- Cloud clients can't use mcpgw: Claude custom connectors (claude.ai, Desktop, mobile), Claude Code on the web, and
  probably Codex cloud.
- Away from home nothing can reach it. A VPN on the client should cover the CLIs if that's wanted later. This machine
  has none today.
