# 0008: Only arch and the cluster can reach mcpgw and llmgw; no auth

- **Status:** accepted, the user's decision. It replaces the first version, which served mcpgw to the whole home network.
  [ADR 0010](0010-home-apps-only-for-now.md) narrows who calls mcpgw: only home apps, for now.
- **Date:** 2026-11-05

## Context

The home apps are shared across the home network, with logins. The two gateways are different: neither has a login,
llmgw spends real Claude, GPT and DeepSeek allowance, and mcpgw can send requests out through the home IP.

Nothing outside arch needs them. homecal, homenews and homestorm all call them inside the cluster, and Claude Code, Codex
and local development run on arch. Yet any of the 22 addresses in arch's ARP cache could use them, and llmgw had open CORS,
so a web page could too.

## Decision

- **No Ingress.** Traefik doesn't serve either gateway, and the router has no DNS name for them.
- **One name everywhere:** `http://llmgw.llmgw.svc.cluster.local` and `http://mcpgw.mcpgw.svc.cluster.local`. Each gateway
  refuses any other Host, which also stops DNS rebinding.
- **On arch,** `/etc/hosts` points those names at their Service IPs, so a browser uses the same URLs as the apps.
  The IPs are pinned in the charts, so a recreated Service keeps its address.
- **No web pages:** a request with another site's `Origin` gets a 403.
- **A firewall rule on arch** ([deploy/host/](../../deploy/host/)) drops traffic from Wi-Fi or Ethernet addressed to the
  Service and pod ranges. Without it, a device that deliberately routes those ranges through arch could reach them.
- **No auth.** There's nobody to authenticate, so it would only add moving parts.

## Alternatives considered

- **Keep them on the network, with tokens.** Three apps and two harnesses would need secrets, to protect a door nobody
  uses. Tokens over plain HTTP can also be sniffed, so doing it properly means adding TLS as well.
- **A Traefik IP allow-list.** Traefik runs behind k3s's load balancer with `externalTrafficPolicy: Cluster`, so per the
  Kubernetes docs it doesn't see the client's real address without changing how traffic reaches every app.
- **A NodePort or `kubectl port-forward`.** The first opens a port on the network; the second has to be kept running.
- **Pointing arch's DNS at CoreDNS.** More machinery than two lines in `/etc/hosts`, and arch resolves `.local` through
  mDNS before DNS anyway.

## Consequences

- **Other devices can't reach them.** To use one from a laptop, SSH into arch or use a tunnel. If that becomes routine,
  that's the time to add tokens and TLS.
- **Clients that connect from a vendor's cloud can't either,** as before: Claude custom connectors and cloud sessions.
- **"Only arch" means arch and the cluster.** Any program on arch, and any pod, can reach them. A NetworkPolicy naming the
  allowed apps could narrow the pods, and hasn't been added.
- **A rebuilt cluster needs a check:** the pinned IPs must fit its service range, and `/etc/hosts` must match.
- **Undoing it for one gateway** takes `ingress.enabled` in its chart, plus adding the name back to its allowed hosts.
