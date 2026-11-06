# 0009: Search sits behind a replaceable provider; SearXNG first

- **Status:** accepted
- **Date:** 2026-11-05

## Context

`web_search` needs a backend. Self-hosted SearXNG costs nothing per query and keeps queries from a single vendor, but
it scrapes other engines, and those can block a home IP. People building agent tools report blocks and rate limits, and
some add a cache and a hosted fallback.

That evidence is weak: forum posts and vendor blogs, with no independent benchmark. Only a real trial from this IP
will tell.

## Decision

- Tool code calls a one-method `SearchProvider`. The tool's arguments and result text don't depend on the backend.
- **SearXNG is the first provider,** in the same namespace with no ingress. Only mcpgw talks to it.
- Keep the design's protections from the start: a 10-minute cache, at most 4 upstream requests at once, and a small
  list of engines.
- **Decide on a fallback from evidence:** about 20 real queries from the home IP at M3, reviewed with the engine-error
  log.

## Alternatives considered

- **A hosted API from the start** (Brave, Tavily or Exa; reported at about $5–8 per 1,000 searches, second-hand). The
  results may well be better and there's nothing to run. Not first, because it costs money per query and sends every
  query to one vendor, and SearXNG might be good enough.
- **SearXNG with no provider layer.** It saves one small interface, and then a fallback means reworking the tool. Not
  worth it, given how likely a fallback is.

## Result of the trial (2026-11-05)

21 queries from the home IP all found results, in 0.7 s on average. Google refused every query, so it's off. Brave
suspended itself after 5 queries. Bing carries most of it, with DuckDuckGo behind it, and niche technical queries are
the weak spot. **No paid fallback for now**: nothing justifies the cost yet, and this decision makes adding one small.

## Consequences

- Swapping or adding a backend changes nothing for callers.
- A hosted fallback would be mcpgw's first paid dependency, and would add its first Secret.
- Engine errors must be logged well enough to judge the trial (`searxng.error`).
