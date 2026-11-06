import { z } from "zod";
import {
  CATEGORIES,
  type SearchHit,
  type SearchOutcome,
  type SearchProvider,
  TIME_RANGES,
} from "../search/types.js";
import type { ToolOutput } from "./result.js";

export const WEB_SEARCH_DESCRIPTION =
  "Search the web for current information. Returns titles, links and short snippets. Use web_fetch to read a page.";

export const webSearchInput = z.object({
  query: z.string().min(1).max(400).describe("What to search for."),
  max_results: z.number().int().min(1).max(10).optional().describe("How many results. Default 5."),
  time_range: z.enum(TIME_RANGES).optional().describe("Only results from this recent period."),
  category: z.enum(CATEGORIES).optional().describe("Kind of results. Default general."),
  language: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .optional()
    .describe("BCP 47 language such as en or de. Default en."),
});

export type WebSearchArgs = z.infer<typeof webSearchInput>;

const SNIPPET_CHARS = 300;

function cut(text: string, chars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= chars ? flat : `${flat.slice(0, chars - 1).trimEnd()}…`;
}

function humanTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function formatSearchText(query: string, results: SearchHit[], searchedAt: string): string {
  if (results.length === 0) {
    return `No results for "${query}" (searched ${humanTime(searchedAt)}). Try different words or a wider time range.`;
  }
  const lines = results.map((r, i) => {
    const published = r.published ? `Published ${r.published}. ` : "";
    return `${i + 1}. ${r.title}\n   ${r.url}\n   ${published}${r.snippet}`;
  });
  return `Results for "${query}" (searched ${humanTime(searchedAt)}):\n\n${lines.join("\n\n")}\n\nUse web_fetch to read a page.`;
}

/** Same URL from several engines is one result. SearXNG mostly does this, a fallback may not. */
function mergeByUrl(hits: SearchHit[]): SearchHit[] {
  const byUrl = new Map<string, SearchHit>();
  for (const hit of hits) {
    const seen = byUrl.get(hit.url);
    if (seen) seen.engines = [...new Set([...seen.engines, ...hit.engines])];
    else byUrl.set(hit.url, { ...hit, engines: [...hit.engines] });
  }
  return [...byUrl.values()];
}

export function shapeResults(outcome: SearchOutcome, maxResults: number): SearchHit[] {
  return mergeByUrl(outcome.results)
    .slice(0, maxResults)
    .map((r) => ({ ...r, title: cut(r.title, 200), snippet: cut(r.snippet, SNIPPET_CHARS) }));
}

export async function webSearch(
  args: WebSearchArgs,
  provider: SearchProvider,
  signal: AbortSignal,
): Promise<ToolOutput> {
  const maxResults = args.max_results ?? 5;
  const outcome = await provider.search(
    {
      query: args.query,
      maxResults,
      category: args.category ?? "general",
      language: args.language ?? "en",
      ...(args.time_range ? { timeRange: args.time_range } : {}),
    },
    signal,
  );
  const results = shapeResults(outcome, maxResults);
  const searchedAt = new Date().toISOString();
  return {
    text: formatSearchText(args.query, results, searchedAt),
    meta: {
      query: args.query,
      results,
      suggestions: outcome.suggestions,
      searched_at: searchedAt,
      cached: false,
    },
    logFields: { query: args.query, results: results.length, cached: false },
  };
}
