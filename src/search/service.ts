import { TtlCache } from "../lib/cache.js";
import { Limiter, QueueTimeout } from "../lib/limiter.js";
import { ToolFailure } from "../tools/result.js";
import type { SearchHit, SearchProvider, SearchQuery } from "./types.js";

export interface StoredSearch {
  results: SearchHit[];
  suggestions: string[];
  searchedAt: string;
}

/** The provider's way of saying that no engine answered. Worth one more try, unlike SearXNG being down. */
function noEngineAnswered(err: unknown): err is ToolFailure {
  return err instanceof ToolFailure && "engine_errors" in err.logFields;
}

export interface SearchServiceOptions {
  cacheTtlMs: number;
  concurrency: number;
  queueWaitMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const CACHE_ENTRIES = 500;

/**
 * A provider with the two protections that keep upstream engines from refusing the home IP: a
 * short cache, and a cap on requests at once across all callers. Engines often come back empty for a
 * moment, so an empty result gets one more try and is never cached: 8 of 29 searches in a real model
 * test came back empty, and a cached one would have stayed empty for 10 minutes.
 */
export class SearchService {
  private readonly cache: TtlCache<StoredSearch>;
  private readonly limiter: Limiter;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(
    readonly provider: SearchProvider,
    options: SearchServiceOptions,
  ) {
    this.cache = new TtlCache(options.cacheTtlMs, CACHE_ENTRIES);
    this.limiter = new Limiter(options.concurrency, options.queueWaitMs ?? 10_000);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retryDelayMs = options.retryDelayMs ?? 1_500;
  }

  async search(
    query: SearchQuery,
    shape: (results: SearchHit[]) => SearchHit[],
    { retryEmpty = true }: { retryEmpty?: boolean } = {},
  ): Promise<StoredSearch & { cached: boolean; retried: boolean }> {
    const key = JSON.stringify([
      query.query,
      query.maxResults,
      query.timeRange ?? null,
      query.category,
      query.language,
    ]);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true, retried: false };

    const once = async (): Promise<StoredSearch> => {
      const outcome = await this.limiter.run(() =>
        this.provider.search(query, AbortSignal.timeout(this.timeoutMs)),
      );
      return {
        results: shape(outcome.results),
        suggestions: outcome.suggestions,
        searchedAt: new Date().toISOString(),
      };
    };
    const retry = async () => {
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      return once();
    };

    try {
      let retried = false;
      let stored: StoredSearch;
      try {
        stored = await once();
        if (stored.results.length === 0 && retryEmpty) {
          retried = true;
          stored = await retry();
        }
      } catch (err) {
        if (retried || !retryEmpty || !noEngineAnswered(err)) throw err;
        retried = true;
        stored = await retry();
      }
      if (stored.results.length > 0) this.cache.set(key, stored);
      return { ...stored, cached: false, retried };
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
