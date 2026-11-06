import { z } from "zod";
import type { SearchService, StoredSearch } from "../search/service.js";
import { CATEGORIES, type SearchHit, type SearchQuery, TIME_RANGES } from "../search/types.js";
import { ToolFailure, type ToolOutput } from "./result.js";

export const WEB_SEARCH_DESCRIPTION =
  "Search the web for current information. Returns titles, links and short snippets. Use web_fetch to read a page.";

export const webSearchInput = z.object({
  query: z.string().min(1).max(400).describe("What to search for."),
  max_results: z.number().int().min(1).max(10).optional().describe("How many results. Default 5."),
  time_range: z.enum(TIME_RANGES).optional().describe("Only results from this recent period."),
  category: z
    .enum(CATEGORIES)
    .optional()
    .describe(
      "Default general, which suits most questions, technical ones too. news is recent news, it is only code sites, science is only papers.",
    ),
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

export function humanTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function formatSearchText(query: string, results: SearchHit[], searchedAt: string): string {
  if (results.length === 0) {
    return `No results for "${query}" (searched ${humanTime(searchedAt)}). Search engines sometimes come back empty, so this doesn't prove nothing exists. Try different or fewer words, or a wider time range.`;
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

/**
 * The language to ask engines for, when the caller didn't say. Asking for English on a Chinese query
 * made Bing return Google Maps help pages.
 */
export function searchLanguage(query: string, explicit?: string): string {
  if (explicit) return explicit;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return "ja";
  if (/\p{Script=Hangul}/u.test(query)) return "ko";
  if (/\p{Script=Han}/u.test(query)) return "zh-CN";
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(query)) return "all";
  return "en";
}

/**
 * The query's `site:` terms, as a test for a URL. Models use them in about half their searches, and
 * not every engine honours them, so they're applied here as well. Null when there are none.
 */
export function siteFilter(query: string): ((url: string) => boolean) | null {
  const sites: { host: string; path: string }[] = [];
  for (const match of query.matchAll(/(?:^|\s)site:(\S+)/gi)) {
    try {
      const url = new URL(`https://${match[1]!.replace(/^https?:\/\//i, "").replace(/["']/g, "")}`);
      sites.push({
        host: url.hostname.replace(/^www\./, ""),
        path: url.pathname.replace(/\/$/, ""),
      });
    } catch {
      // Not a real address, so nothing to filter on.
    }
  }
  if (sites.length === 0) return null;
  return (raw) => {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      return sites.some(
        (s) => (host === s.host || host.endsWith(`.${s.host}`)) && url.pathname.startsWith(s.path),
      );
    } catch {
      return false;
    }
  };
}

export function shapeResults(hits: SearchHit[], maxResults: number, query = ""): SearchHit[] {
  const inSite = siteFilter(query);
  return mergeByUrl(inSite ? hits.filter((h) => inSite(h.url)) : hits)
    .slice(0, maxResults)
    .map((r) => ({ ...r, title: cut(r.title, 200), snippet: cut(r.snippet, SNIPPET_CHARS) }));
}

/** Fewer than this from a narrow category, and a general search fills in the rest. */
const ENOUGH_RESULTS = 3;

/**
 * Narrow categories have few engines: `it` is only GitHub and Stack Overflow, and a model asking it
 * for "Next.js latest version" got one stray result, or none. So one that finds too little is widened,
 * rather than leaving the model to work out why.
 */
async function searchWidening(
  query: SearchQuery,
  shape: (hits: SearchHit[]) => SearchHit[],
  service: SearchService,
): Promise<StoredSearch & { cached: boolean; retried: boolean; widened: boolean }> {
  if (query.category === "general") {
    return { ...(await service.search(query, shape)), widened: false };
  }
  const narrow = await service.search(query, shape, { retryEmpty: false }).catch((err) => {
    if (err instanceof ToolFailure) return null;
    throw err;
  });
  if (narrow && narrow.results.length >= ENOUGH_RESULTS) return { ...narrow, widened: false };
  const wide = await service.search({ ...query, category: "general" }, shape);
  const results = [...(narrow?.results ?? []), ...wide.results];
  const seen = new Set<string>();
  return {
    ...wide,
    results: results.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, query.maxResults),
    widened: true,
  };
}

export async function webSearch(args: WebSearchArgs, service: SearchService): Promise<ToolOutput> {
  const maxResults = args.max_results ?? 5;
  const category = args.category ?? "general";
  const found = await searchWidening(
    {
      query: args.query,
      maxResults,
      category,
      language: searchLanguage(args.query, args.language),
      ...(args.time_range ? { timeRange: args.time_range } : {}),
    },
    (hits) => shapeResults(hits, maxResults, args.query),
    service,
  );
  return {
    text: formatSearchText(args.query, found.results, found.searchedAt),
    meta: {
      query: args.query,
      results: found.results,
      suggestions: found.suggestions,
      searched_at: found.searchedAt,
      cached: found.cached,
    },
    logFields: {
      query: args.query,
      results: found.results.length,
      cached: found.cached,
      category,
      ...(args.time_range ? { time_range: args.time_range } : {}),
      ...(found.retried ? { retried: true } : {}),
      ...(found.widened ? { widened: true } : {}),
    },
  };
}
