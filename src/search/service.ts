import { TtlCache } from "../lib/cache.js";
import { Limiter, QueueTimeout } from "../lib/limiter.js";
import { ToolFailure } from "../tools/result.js";
import type { SearchHit, SearchProvider, SearchQuery } from "./types.js";

export interface StoredSearch {
  results: SearchHit[];
  suggestions: string[];
  searchedAt: string;
}

export interface SearchServiceOptions {
  cacheTtlMs: number;
  concurrency: number;
  queueWaitMs?: number;
  timeoutMs?: number;
}

const CACHE_ENTRIES = 500;

/**
 * A provider with the two protections that keep upstream engines from refusing the home IP: a
 * short cache, and a cap on requests at once across all callers. Failures aren't cached.
 */
export class SearchService {
  private readonly cache: TtlCache<StoredSearch>;
  private readonly limiter: Limiter;
  private readonly timeoutMs: number;

  constructor(
    readonly provider: SearchProvider,
    options: SearchServiceOptions,
  ) {
    this.cache = new TtlCache(options.cacheTtlMs, CACHE_ENTRIES);
    this.limiter = new Limiter(options.concurrency, options.queueWaitMs ?? 10_000);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async search(
    query: SearchQuery,
    shape: (results: SearchHit[]) => SearchHit[],
  ): Promise<StoredSearch & { cached: boolean }> {
    const key = JSON.stringify([
      query.query,
      query.maxResults,
      query.timeRange ?? null,
      query.category,
      query.language,
    ]);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };

    try {
      const outcome = await this.limiter.run(() =>
        this.provider.search(query, AbortSignal.timeout(this.timeoutMs)),
      );
      const stored: StoredSearch = {
        results: shape(outcome.results),
        suggestions: outcome.suggestions,
        searchedAt: new Date().toISOString(),
      };
      this.cache.set(key, stored);
      return { ...stored, cached: false };
    } catch (err) {
      if (err instanceof QueueTimeout) {
        throw new ToolFailure(
          "Too many searches are running right now. Try again in a moment.",
          "timeout",
        );
      }
      throw err;
    }
  }
}
