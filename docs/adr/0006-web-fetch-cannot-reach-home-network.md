# 0006: `web_fetch` can't reach the home network

- **Status:** accepted
- **Date:** 2026-11-05

## Context

`web_fetch` makes the cluster send requests to addresses a model chose, and a page can influence that choice. Without
limits it's a way into llmgw, the other apps, the router and everything else on the network (SSRF).

OWASP separates fixed destinations from "any external URL". For the second it says allow-lists can't be used, and a
block-list is the best option, with the check made against the address actually connected to. It also highly
recommends a block at the network level. The MCP security page warns against hand-written IP checks, because of
encoding tricks.

## Decision

Two independent layers ([design §6](../design.md)).

**In the app:**

- `http` and `https` only, no credentials in the URL, one URL parser, limited ports and URL length.
- Check the resolved IP at connect time through a custom DNS lookup, keeping the original name for `Host` and TLS. IPs
  written directly in a URL are checked up front, because Node skips the lookup for them.
- Only addresses `ipaddr.js` classes as `unicast` pass.
- Follow redirects by hand, and check every hop again.

**In the network:** NetworkPolicies, so `mcpgw` and `searxng` pods can't reach private ranges even if the app's checks
have a bug.

## Alternatives considered

- **Checking the URL once before connecting.** Rejected: DNS rebinding gets past it.
- **Only the NetworkPolicy.** Rejected: the model would get a timeout rather than a clear reason, and names such as
  `.svc` are better refused by name.
- **Only the app's checks.** Rejected: one bug would open the home network.
- **An egress proxy such as Smokescreen,** which the MCP spec mentions. Rejected for v1: one more service on a single
  node, when a NetworkPolicy gives the second layer.

## Consequences

- The test table in M4 comes before any page-reading code.
- k3s runs here with no flag disabling network policies, and `argocd` already has some, but enforcement isn't proven.
  M4 proves it from inside the pod, with the app's checks out of the way.
- Nothing can use `web_fetch` to read home services. That's intended: home data gets its own read-only tools later.
- This protects the network and not the conversation. Leaks are [0007](0007-keeping-data-from-leaking-through-web-fetch.md).
