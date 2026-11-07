# 0013: Read sites that refuse mcpgw through their official APIs

- **Status:** accepted, as step 2 of the plan the user chose on 2026-11-07 ("we will do 1-4").
- **Date:** 2026-11-07

## Context

Six of the 36 benchmark pages refuse mcpgw's requests with a 403: Stack Overflow, npm, Medium, AP, Allrecipes and Zhihu. In both real
meetings, every seat that tried Stack Overflow was refused and answered from memory. Disguising mcpgw as a browser isn't an option
(design §2, and auto mode blocked even testing it). Two of the six offer an official, keyless API for exactly this.

## Decision

**`web_fetch` reads Stack Exchange questions and npm package pages through their APIs,** with the same output and limits as any page.

- **Stack Exchange** (Stack Overflow, Super User, Server Fault, Ask Ubuntu, MathOverflow and `*.stackexchange.com`): a question, `/q/`
  or `/a/` link reads the question and its 5 highest-voted answers from `api.stackexchange.com`, marking the accepted one. The
  `backoff` the API sometimes asks for is honoured per method. The content is CC BY-SA, and the text says so.
- **npm** (`npmjs.com/package/<name>`, scoped, and `/v/<version>`): the dist-tags and the version's manifest come from
  `registry.npmjs.org`, and the README from the package's published files on jsDelivr. The registry only has the README in the full
  package document, which is 6 MB for hono and 16 MB for typescript, past what mcpgw reads.
- **The model cites the page,** not the API: the final URL is the question or package page.
- **API calls go through the guarded fetcher,** so the address checks, size limit and timeouts all still apply.

## Alternatives considered

- **A tool per site,** such as `stackoverflow_search`. Rejected: more tools for models to choose between, when the URL already says
  which site it is.
- **The full npm package document.** Rejected: too large for popular packages, and parsing 16 MB of JSON would block other callers.
- **Medium, AP, Allrecipes and Zhihu:** no official keyless API, so they stay refused.

## Consequences

- **Stack Exchange allows 300 calls a day per IP without a key,** and a question takes 2. That's ample for home use. A key would raise
  it to 10,000, if it's ever needed.
- **jsDelivr is a third party.** If it's down, the page still reads, saying it has no README.
- **Each new site is a code change.** That's intended: only sites with an official API qualify.
