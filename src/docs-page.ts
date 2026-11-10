import { html } from "hono/html";
import { z } from "zod";
import type { EngineIssue } from "./search/types.js";
import { humanTime } from "./tools/web-search.js";

export interface DocsTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  inputSchema: z.ZodType;
  /** A limit worth stating, or what the tool refuses. */
  note: string;
  /** Where the app enforces a tighter limit than the schema, what to show instead. */
  inputTypes?: Record<string, string>;
}

export interface DocsPageData {
  name: string;
  version: string;
  commit: string | null;
  description: string;
  startedAt: string;
  /** The Host this request used, already checked against the allowed list. */
  host: string;
  backendName: string;
  backend: "ok" | "down" | "unknown";
  /** Null when the backend doesn't report on its engines. */
  engineIssues: EngineIssue[] | null;
  /** Null when code_run isn't offered. */
  codeRunner: "ok" | "down" | "unknown" | null;
  tools: DocsTool[];
}

interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  description?: string;
}

export interface InputField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function typeLabel(p: SchemaProperty): string {
  if (p.enum) return p.enum.join(", ");
  if (p.type === "string" && p.maxLength !== undefined) {
    return `string, up to ${p.maxLength} characters`;
  }
  if (p.type === "integer" || p.type === "number") {
    // Zod fills in the safe-integer limits when a schema sets none, and those say nothing useful.
    const hasMax = p.maximum !== undefined && p.maximum < Number.MAX_SAFE_INTEGER;
    if (p.minimum !== undefined && hasMax) return `${p.type}, ${p.minimum} to ${p.maximum}`;
    if (p.minimum !== undefined) return `${p.type}, from ${p.minimum}`;
  }
  return p.type ?? "any";
}

/** The same JSON Schema conversion callers get from `tools/list`, as rows for a table. */
export function inputFields(schema: z.ZodType): InputField[] {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, p]) => ({
    name,
    type: typeLabel(p),
    required: json.required?.includes(name) ?? false,
    description: p.description ?? "",
  }));
}

const STATE_WORDS = { ok: "OK", down: "Down", unknown: "Not checked yet" };

function engineSection(issues: EngineIssue[] | null) {
  if (issues === null) return "";
  return html`<h3>Search engines that failed in the last hour</h3>
    ${
      issues.length === 0
        ? html`<p>None.</p>`
        : html`<div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Engine</th>
                  <th>Reason</th>
                  <th>Last failed</th>
                  <th>Times</th>
                  <th>Left out until</th>
                </tr>
              </thead>
              <tbody>
                ${issues.map(
                  (i) =>
                    html`<tr>
                      <td><code>${i.engine}</code></td>
                      <td>${i.reason}</td>
                      <td>${humanTime(i.lastAt)}</td>
                      <td>${i.count}</td>
                      <td>${i.pausedUntil ? humanTime(i.pausedUntil) : "Not left out"}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>
          <p class="note">
            SearXNG carries on with the other engines, so this doesn't mean search is down. A search
            only fails when every engine does. An engine that refused mcpgw, with a CAPTCHA or "too many
            requests", or timed out on 3 searches in a row, is left out for 5 minutes, doubling each time it
            refuses again, up to an hour.
          </p>`
    }
    <p class="note">This list resets when mcpgw restarts. Loki keeps the history.</p>`;
}

function toolSection(tool: DocsTool) {
  return html`<article>
    <h3><code>${tool.name}</code> <span class="tag">${tool.readOnly ? "Read-only" : "Writes"}</span></h3>
    <p>${tool.description}</p>
    <p class="note">${tool.note}</p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Input</th>
            <th>Type</th>
            <th>Required</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          ${inputFields(tool.inputSchema).map(
            (f) =>
              html`<tr>
                <td><code>${f.name}</code></td>
                <td>${tool.inputTypes?.[f.name] ?? f.type}</td>
                <td>${f.required ? "Yes" : "No"}</td>
                <td>${f.description}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </article>`;
}

/** Plain server-rendered HTML: no scripts, nothing loaded from elsewhere. `html` escapes every value. */
export function renderDocsPage(page: DocsPageData) {
  const commit = page.commit;
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:," />
        <title>mcpgw status</title>
        <style>
          :root {
            color-scheme: light dark;
            --bg: #fbfbfa;
            --panel: #ffffff;
            --text: #1d1f21;
            --muted: #5c6166;
            --line: #dfe1e3;
            --code: #f0f1f2;
            --ok: #17723b;
            --bad: #b3261e;
            --link: #1a5fb4;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #16181a;
              --panel: #1e2124;
              --text: #e6e7e8;
              --muted: #a1a6ab;
              --line: #33373b;
              --code: #2a2d31;
              --ok: #5fd08a;
              --bad: #ff8a80;
              --link: #8ab4f8;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
          h1 { margin: 0; font-size: 28px; }
          h2 { margin: 40px 0 12px; font-size: 20px; }
          h3 { margin: 24px 0 8px; font-size: 16px; }
          p { margin: 8px 0; }
          a { color: var(--link); }
          code, pre { font: 14px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
          code { background: var(--code); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
          pre { background: var(--code); border-radius: 6px; padding: 12px; overflow-x: auto; margin: 8px 0; }
          pre code { background: none; padding: 0; overflow-wrap: normal; }
          td:first-child code { white-space: nowrap; overflow-wrap: normal; }
          dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: 6px 20px;
            margin: 0;
            padding: 16px;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
          }
          dt { color: var(--muted); }
          dd { margin: 0; min-width: 0; }
          article {
            margin: 16px 0;
            padding: 4px 16px 12px;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
          }
          .scroll { overflow-x: auto; }
          table { width: 100%; border-collapse: collapse; font-size: 15px; }
          th, td { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
          th { color: var(--muted); font-weight: 600; white-space: nowrap; }
          tbody tr:last-child td { border-bottom: 0; }
          .lead { color: var(--muted); }
          .note { color: var(--muted); font-size: 14px; }
          .tag {
            margin-left: 4px;
            padding: 1px 8px;
            border: 1px solid var(--line);
            border-radius: 999px;
            color: var(--muted);
            font-size: 12px;
            font-weight: 400;
          }
          .state-ok { color: var(--ok); font-weight: 600; }
          .state-down { color: var(--bad); font-weight: 600; }
          .state-unknown { color: var(--muted); font-weight: 600; }
        </style>
      </head>
      <body>
        <main>
          <h1>${page.name}</h1>
          <p class="lead">${page.description}</p>

          <h2>Status</h2>
          <dl>
            <dt>Version</dt>
            <dd>${page.version}</dd>
            <dt>Commit</dt>
            <dd>
              ${
                commit
                  ? html`<a href="https://github.com/autumnfallenwang/mcpgw/commit/${commit}"
                    ><code>${commit.slice(0, 7)}</code></a
                  >`
                  : "Not set (local run)"
              }
            </dd>
            <dt>Running since</dt>
            <dd>${humanTime(page.startedAt)}</dd>
            <dt>Search backend</dt>
            <dd>
              <code>${page.backendName}</code>
              <span class="state-${page.backend}">${STATE_WORDS[page.backend]}</span>
            </dd>
            ${
              page.codeRunner
                ? html`<dt>Code runner</dt>
                    <dd><span class="state-${page.codeRunner}">${STATE_WORDS[page.codeRunner]}</span></dd>`
                : ""
            }
          </dl>
          ${engineSection(page.engineIssues)}

          <h2>Tools</h2>
          ${page.tools.map(toolSection)}

          <h2>Connect</h2>
          <p>
            Only home apps call mcpgw for now, from inside the cluster, and other devices can't reach it
            (<a href="https://github.com/autumnfallenwang/mcpgw/blob/main/docs/adr/0010-home-apps-only-for-now.md">ADR 0010</a>).
            It speaks MCP, at <code>POST http://${page.host}/mcp</code>.
          </p>
          <pre><code>import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://${page.host}/mcp")));

const { tools } = await client.listTools();
const result = await client.callTool({ name: "web_search", arguments: { query: "..." } });</code></pre>
          <p>
            An app must limit which URLs it passes to <code>web_fetch</code>: mcpgw can't tell where a URL
            came from, so it can't stop a page telling a model to leak data
            (<a href="https://github.com/autumnfallenwang/mcpgw/blob/main/docs/adr/0007-keeping-data-from-leaking-through-web-fetch.md">ADR 0007</a>).
          </p>

          <h2>Logs</h2>
          <p>
            In <a href="http://grafana.arch.internal/explore">Grafana Explore</a>, or pick
            <code>mcpgw</code> on the Home apps HTTP overview dashboard.
          </p>
          <div class="scroll">
            <table>
              <tbody>
                <tr>
                  <td>Tool calls</td>
                  <td><code>{namespace="mcpgw"} | json | event="tool.call"</code></td>
                </tr>
                <tr>
                  <td>Search engine failures</td>
                  <td><code>{namespace="mcpgw"} | json | event="searxng.error"</code></td>
                </tr>
                <tr>
                  <td>Engines left out after refusing</td>
                  <td><code>{namespace="mcpgw"} | json | event="searxng.engine_paused"</code></td>
                </tr>
                <tr>
                  <td>Pages with little text</td>
                  <td><code>{namespace="mcpgw"} | json | event="tool.call" | thin="true"</code></td>
                </tr>
                <tr>
                  <td>Refused URLs</td>
                  <td><code>{namespace="mcpgw"} | json | event="fetch.blocked"</code></td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2>More</h2>
          <p>
            <a href="/health"><code>/health</code></a> and <a href="/"><code>/</code></a> return the same
            basics as JSON. The design and decisions are
            <a href="https://github.com/autumnfallenwang/mcpgw">on GitHub</a>.
          </p>
        </main>
      </body>
    </html>`;
}
