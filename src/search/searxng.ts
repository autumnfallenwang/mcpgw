import { z } from "zod";
import { log } from "../lib/logger.js";
import { ToolFailure } from "../tools/result.js";
import type {
  EngineIssue,
  SearchHit,
  SearchOutcome,
  SearchProvider,
  SearchQuery,
} from "./types.js";

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string().nullish(),
        content: z.string().nullish(),
        engines: z.array(z.string()).nullish(),
        publishedDate: z.string().nullish(),
      }),
    )
    .default([]),
  suggestions: z.array(z.string()).default([]),
  unresponsive_engines: z.array(z.tuple([z.string(), z.string()])).default([]),
});

const DOWN_MESSAGE =
  "The search backend isn't answering right now. Try again shortly, or answer without searching and say so.";

const ISSUE_WINDOW_MS = 60 * 60 * 1000;

function publishedDay(value: string | null | undefined): string | undefined {
  const day = value?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/** A day's slack, since engines date stories in other time zones and a story from last night is still today's news. */
const RANGE_DAYS = { day: 2, week: 8, month: 32, year: 367 };

function cutoffFor(range: SearchQuery["timeRange"]): number | null {
  return range ? Date.now() - RANGE_DAYS[range] * 86_400_000 : null;
}

export function createSearxngProvider(baseUrl: string): SearchProvider {
  // Only for the status page, so memory is enough: Loki has the history as searxng.error.
  const issues = new Map<string, { reason: string; lastAt: number; count: number }>();

  return {
    name: "searxng",

    engineIssues(): EngineIssue[] {
      const cutoff = Date.now() - ISSUE_WINDOW_MS;
      const recent: EngineIssue[] = [];
      for (const [engine, issue] of issues) {
        if (issue.lastAt < cutoff) issues.delete(engine);
        else recent.push({ engine, ...issue, lastAt: new Date(issue.lastAt).toISOString() });
      }
      return recent.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    },

    async search(query: SearchQuery, signal: AbortSignal): Promise<SearchOutcome> {
      const url = new URL("/search", baseUrl);
      url.searchParams.set("q", query.query);
      url.searchParams.set("format", "json");
      url.searchParams.set("language", query.language);
      url.searchParams.set("categories", query.category);
      // SearXNG skips any engine with no time-range support when given a range, and that's nearly every news
      // engine: a real meeting's news searches were left with Bing News alone. So news is checked by date here.
      const newsCutoff = query.category === "news" ? cutoffFor(query.timeRange) : null;
      if (query.timeRange && query.category !== "news") {
        url.searchParams.set("time_range", query.timeRange);
      }

      let body: z.infer<typeof responseSchema>;
      try {
        const res = await fetch(url, { signal, headers: { accept: "application/json" } });
        if (!res.ok) {
          log.error({ event: "searxng.error", status: res.status }, "search backend error");
          throw new ToolFailure(DOWN_MESSAGE, "error");
        }
        body = responseSchema.parse(await res.json());
      } catch (err) {
        if (err instanceof ToolFailure) throw err;
        if (signal.aborted) {
          throw new ToolFailure(
            "The search took too long. Try again with simpler words.",
            "timeout",
          );
        }
        log.error({ event: "searxng.error", err }, "search backend error");
        throw new ToolFailure(DOWN_MESSAGE, "error");
      }

      const engineErrors = Object.fromEntries(body.unresponsive_engines);
      const now = Date.now();
      for (const [engine, reason] of body.unresponsive_engines) {
        const seen = issues.get(engine);
        const count = seen && now - seen.lastAt < ISSUE_WINDOW_MS ? seen.count + 1 : 1;
        issues.set(engine, { reason, lastAt: now, count });
      }
      if (body.unresponsive_engines.length > 0) {
        log.warn(
          { event: "searxng.error", status: 200, engine_errors: engineErrors },
          "engines failed",
        );
      }

      const results: SearchHit[] = [];
      for (const r of body.results) {
        if (!r.url || !/^https?:\/\//.test(r.url)) continue;
        const published = publishedDay(r.publishedDate);
        if (newsCutoff && published && Date.parse(published) < newsCutoff) continue;
        results.push({
          title: r.title?.trim() || r.url,
          url: r.url,
          snippet: r.content ?? "",
          engines: r.engines ?? [],
          ...(published ? { published } : {}),
        });
      }

      // Nothing found because every engine failed isn't the same as nothing existing.
      if (results.length === 0 && body.unresponsive_engines.length > 0) {
        throw new ToolFailure(
          "The search engines didn't answer this time, so this says nothing about whether results exist. Try again shortly, or answer without searching and say so.",
          "error",
          { engine_errors: engineErrors },
        );
      }

      return { results, suggestions: body.suggestions };
    },

    async health() {
      try {
        const res = await fetch(new URL("/healthz", baseUrl), {
          signal: AbortSignal.timeout(2_000),
        });
        return res.ok ? "ok" : "down";
      } catch {
        return "down";
      }
    },
  };
}
