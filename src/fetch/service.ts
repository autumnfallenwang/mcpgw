import { TtlCache } from "../lib/cache.js";
import { Limiter, QueueTimeout } from "../lib/limiter.js";
import { log } from "../lib/logger.js";
import { ToolFailure } from "../tools/result.js";
import { HTML_TYPES } from "./extract.js";
import { ExtractFailure, type ExtractorPool } from "./extractor-pool.js";
import { type Fetcher, FetchFailure, HttpFailure } from "./fetcher.js";
import { BlockedUrl } from "./guard.js";

export interface ReadablePage {
  url: string;
  finalUrl: string;
  title: string;
  contentType: string;
  text: string;
  bytes: number;
  /** The page was larger than mcpgw reads, so its end is missing. */
  partial: boolean;
  fetchedAt: string;
}

export interface FetchServiceOptions {
  cacheTtlMs: number;
  concurrency: number;
  queueWaitMs?: number;
}

const CACHE_ENTRIES = 100;

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
]);

function httpMessage(status: number): string {
  if (status === 401 || status === 403 || status === 451) {
    return `This site refused the request (HTTP ${status}). Don't retry it: use another source.`;
  }
  if (status === 404 || status === 410) {
    return `That page doesn't exist (HTTP ${status}). Check the link, or use another source.`;
  }
  if (status === 429) {
    return "This site is rate-limiting requests (HTTP 429). Use another source.";
  }
  return `The site returned an error (HTTP ${status}). Try another source.`;
}

function failureMessage(err: FetchFailure): string {
  switch (err.kind) {
    case "timeout":
      return "The page took too long to load. Try another source.";
    case "dns":
      return `The site ${err.host} doesn't exist or can't be found. Check the link.`;
    case "connect":
      return `Couldn't connect to ${err.host}. Try another source.`;
    case "too_many_redirects":
      return "The page redirected too many times. Try another source.";
    case "bad_redirect":
      return "The page sent an invalid redirect. Try another source.";
  }
}

/** Reads a page once and keeps its text for a while, so paging through `start` doesn't refetch. */
export class FetchService {
  private readonly cache: TtlCache<ReadablePage>;
  private readonly limiter: Limiter;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly extractors: ExtractorPool,
    options: FetchServiceOptions,
  ) {
    this.cache = new TtlCache(options.cacheTtlMs, CACHE_ENTRIES);
    this.limiter = new Limiter(options.concurrency, options.queueWaitMs ?? 10_000);
  }

  async read(url: string): Promise<ReadablePage & { cached: boolean }> {
    const hit = this.cache.get(url);
    if (hit) return { ...hit, cached: true };

    let page: ReadablePage;
    try {
      page = await this.limiter.run(() => this.fetchAndExtract(url));
    } catch (err) {
      throw this.toToolFailure(err);
    }
    this.cache.set(url, page);
    if (page.finalUrl !== url) this.cache.set(page.finalUrl, page);
    return { ...page, cached: false };
  }

  private async fetchAndExtract(url: string): Promise<ReadablePage> {
    const fetched = await this.fetcher.fetch(url);
    const base = {
      url,
      finalUrl: fetched.finalUrl.href,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
      partial: fetched.partial,
      fetchedAt: new Date().toISOString(),
    };
    if (
      HTML_TYPES.has(fetched.contentType) ||
      TEXT_TYPES.has(fetched.contentType) ||
      fetched.contentType.endsWith("+json")
    ) {
      // Page content is only ever handled in a worker, never on the thread serving other callers.
      const { title, text } = await this.extractors.run({
        bytes: new Uint8Array(fetched.body),
        contentType: fetched.contentType,
        ...(fetched.charset ? { charset: fetched.charset } : {}),
        finalUrl: fetched.finalUrl.href,
      });
      return { ...base, title, text };
    }

    const kind = fetched.contentType || "an unknown type";
    throw new ToolFailure(
      `mcpgw can't read this type of file: ${kind}. Try another source.`,
      "error",
      {
        content_type: fetched.contentType,
        final_host: fetched.finalUrl.hostname,
      },
    );
  }

  private toToolFailure(err: unknown): unknown {
    if (err instanceof ToolFailure) return err;
    if (err instanceof QueueTimeout) {
      return new ToolFailure(
        "Too many pages are being read right now. Try again in a moment.",
        "timeout",
      );
    }
    if (err instanceof ExtractFailure) {
      return new ToolFailure(
        "This page is too large or complicated for mcpgw to read. Try another source.",
        "error",
        { reason: `extract_${err.kind}` },
      );
    }
    if (err instanceof BlockedUrl) {
      log.warn({ event: "fetch.blocked", reason: err.reason, host: err.host }, "URL refused");
      return new ToolFailure(
        `mcpgw refused this URL: ${err.reason}. It only reads public web addresses, so retrying won't help.`,
        "blocked",
        { reason: err.reason, ...(err.host ? { final_host: err.host } : {}) },
      );
    }
    if (err instanceof HttpFailure) {
      return new ToolFailure(httpMessage(err.status), "error", {
        http_status: err.status,
        final_host: err.host,
      });
    }
    if (err instanceof FetchFailure) {
      return new ToolFailure(failureMessage(err), err.kind === "timeout" ? "timeout" : "error", {
        reason: err.kind,
        ...(err.host ? { final_host: err.host } : {}),
      });
    }
    return err;
  }
}
