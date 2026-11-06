export const TIME_RANGES = ["day", "week", "month", "year"] as const;
export const CATEGORIES = ["general", "news", "it", "science"] as const;

export interface SearchQuery {
  query: string;
  maxResults: number;
  timeRange?: (typeof TIME_RANGES)[number];
  category: (typeof CATEGORIES)[number];
  language: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
  published?: string;
}

export interface SearchOutcome {
  results: SearchHit[];
  suggestions: string[];
}

/** An engine the backend reported as failing. */
export interface EngineIssue {
  engine: string;
  reason: string;
  lastAt: string;
  count: number;
}

/**
 * The search backend. The tool's arguments and result text don't depend on which one runs, so a
 * hosted API could replace SearXNG with no change for callers (ADR 0009).
 */
export interface SearchProvider {
  readonly name: string;
  search(query: SearchQuery, signal: AbortSignal): Promise<SearchOutcome>;
  health(): Promise<"ok" | "down">;
  /** Engines that failed recently, for a backend that reports on them. */
  engineIssues?(): EngineIssue[];
}
