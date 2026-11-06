# 0004: Tool results are text for the model, with app data in `_meta`

- **Status:** accepted
- **Date:** 2026-11-05

## Context

The first design returned a text block written for models and `structuredContent` for apps. That assumed clients show
models the text. A test tool put different prices in each block, and the `tool_result` Claude Code delivered was read
directly ([dev/harness-check/](../../dev/harness-check/)):

| Result shape | Claude Code 2.1.318 gave its model | Codex 0.166.0 gave its model |
|---|---|---|
| Text + `structuredContent` | The JSON only; **the text block was dropped** | Both, so everything is sent twice |
| Text only, with `_meta` | The text | The text |

So hints such as "call again with start=N" would never reach Claude Code's model, and 40,000 characters of page text
would cost double on Codex. The spec doesn't say which block a client must show.

`_meta` reached neither model, and Codex's client event showed it arriving, so it can carry data for apps.

## Decision

- `content` holds one text block that carries everything a model needs.
- `_meta["arch.internal/mcpgw"]` holds the same data as JSON for apps. For `web_fetch` that's metadata only: the page
  text stays in `content`.
- No `structuredContent` and no `outputSchema`.

## Alternatives considered

- **Formatted text + `structuredContent`** (the first design). Rejected: the results above.
- **Serialized JSON in the text block + `structuredContent`,** which is what the spec suggests for tools that return
  structured data. Rejected: Codex still gets it twice, and page text inside JSON is harder to read and costs more
  tokens.
- **Page text in the text block, metadata in `structuredContent`.** Rejected: Claude Code's model would lose the page.

## Consequences

- Every client sees the same text, sent once.
- Apps read `_meta`, which has no schema the client can check, so mcpgw's types need to be shared or validated on the
  app side. Reading it through the v2 TypeScript client is tested at M2.
- If a later tool returns data that's naturally a table, this can be revisited for that tool.
- This rests on harness behaviour the spec doesn't set, so the harness check is re-run when a harness changes.
