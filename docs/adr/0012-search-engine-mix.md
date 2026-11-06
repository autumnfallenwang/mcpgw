# 0012: Yahoo and DuckDuckGo lead the search, with Bing as a backup

- **Status:** accepted, as part of M9, which the user told to go ahead on 2026-11-06.
- **Date:** 2026-11-06

## Context

SearXNG has no index of its own, so its quality depends on which engines it asks and which of them tolerate the home IP. Bing was
carrying most of it, and Bing often returned off-topic results: the first result for "latest stable postgresql version" was
foxnews.com. It also ignores `site:`, which models use often. Brave was nearly always rate-limited, and Google, Qwant, Startpage,
Mojeek, Baidu and Sogou refused or failed for this IP.

## Decision

- **Yahoo and DuckDuckGo lead** general search.
- **Bing stays at weight 0.2,** as a backup that fills in when the others have too little.
- **Bing News and DuckDuckGo News** still serve news.
- **Brave goes.**

## Measured

31 searches through the tools alone, each mix on 2026-11-06, using the same mcpgw image in temporary local containers:

| Mix | On the topic | First result on the topic | `site:` | Empty |
|---|---|---|---|---|
| Before: Bing, DuckDuckGo, Brave | 86% | 27 of 31 | 2 of 15 | 0 |
| Yahoo added, Brave dropped | 88% | 27 of 31 | 6 of 15 | 0 |
| Yahoo and DuckDuckGo only | 96% | 28 of 31 | 15 of 15 | 2, on news |
| **Yahoo and DuckDuckGo, Bing at 0.2: chosen** | **94%** | **30 of 31** | 12 of 15 | 0 |
| Before, with DuckDuckGo blocked | 81% | 25 of 31 | 0 of 15 | 0 |
| Yahoo and Bing, with DuckDuckGo blocked | 90% | 27 of 31 | 6 of 15 | 0 |

On the real cluster, the chosen mix took results from 83% to 94% on the topic, and the first result from 25 to 30 of 31.

An earlier, unpaced test had suggested 98% for Yahoo alone against 57% for the old mix. That overstated the gain, because the test
itself had drawn CAPTCHAs. Simply adding Yahoo barely helped: what made the difference was moving Bing to the back.

## Alternatives considered

- **Dropping Bing.** The most on-topic results, but no spare engine, and news gets weak with only DuckDuckGo's.
- **Re-ranking results in mcpgw.** Not needed at these numbers.
- **A hosted search API.** Not needed at these numbers either (D10 in the plan). It's still the fallback if the engines degrade, and
  [ADR 0009](0009-search-behind-a-replaceable-provider.md) means callers wouldn't notice.

## Consequences

- **Any engine can start refusing this IP at any time,** Yahoo included. This is the mix that works today, not a permanent answer, so
  re-run `dev/benchmark/retrieval.mjs` when search seems worse.
- **Yahoo and DuckDuckGo are one failure each from weaker results,** which is why Bing stays.
