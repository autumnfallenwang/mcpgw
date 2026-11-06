import { describe, expect, it } from "vitest";
import { SearchService } from "../src/search/service.js";
import type { SearchHit, SearchProvider, SearchQuery } from "../src/search/types.js";
import { ToolFailure } from "../src/tools/result.js";
import {
  formatSearchText,
  searchLanguage,
  shapeResults,
  webSearch,
} from "../src/tools/web-search.js";

const hit = (url: string, engines: string[] = ["bing"]) => ({
  title: `Title ${url}`,
  url,
  snippet: "A snippet",
  engines,
});

describe("formatSearchText", () => {
  it("numbers results and points at web_fetch", () => {
    const text = formatSearchText(
      "postgres",
      [{ ...hit("https://a.example/"), published: "2026-09-25" }],
      "2026-11-04T18:00:00.000Z",
    );
    expect(text).toContain('Results for "postgres" (searched 2026-11-04 18:00 UTC):');
    expect(text).toContain(
      "1. Title https://a.example/\n   https://a.example/\n   Published 2026-09-25. A snippet",
    );
    expect(text).toContain("Use web_fetch to read a page.");
  });

  it("treats no results as a normal answer that says what to try", () => {
    const text = formatSearchText("zzz", [], "2026-11-04T18:00:00.000Z");
    expect(text).toContain('No results for "zzz"');
    expect(text).toContain("Try different or fewer words");
  });
});

describe("shapeResults", () => {
  it("merges the same URL from several engines", () => {
    const shaped = shapeResults(
      [hit("https://a.example/", ["bing"]), hit("https://a.example/", ["google"])],
      5,
    );
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.engines).toEqual(["bing", "google"]);
  });

  it("cuts snippets to 300 characters and collapses whitespace", () => {
    const [shaped] = shapeResults(
      [{ ...hit("https://a.example/"), snippet: `a  \n b ${"x".repeat(400)}` }],
      5,
    );
    expect(shaped?.snippet.length).toBeLessThanOrEqual(300);
    expect(shaped?.snippet.startsWith("a b x")).toBe(true);
    expect(shaped?.snippet.endsWith("…")).toBe(true);
  });

  it("keeps to max_results", () => {
    const results = [1, 2, 3].map((n) => hit(`https://a.example/${n}`));
    expect(shapeResults(results, 2)).toHaveLength(2);
  });
});

describe("webSearch", () => {
  it("applies the defaults", async () => {
    let seen: SearchQuery | undefined;
    const provider: SearchProvider = {
      name: "test",
      search(query) {
        seen = query;
        return Promise.resolve({ results: [], suggestions: [] });
      },
      health: () => Promise.resolve("ok"),
    };
    const service = new SearchService(provider, { cacheTtlMs: 1000, concurrency: 1 });
    const output = await webSearch({ query: "x" }, service);
    expect(seen).toEqual({ query: "x", maxResults: 5, category: "general", language: "en" });
    expect(output.logFields).toMatchObject({ query: "x", results: 0, cached: false });
  });
});

describe("searchLanguage", () => {
  it.each([
    ["postgres release notes", undefined, "en"],
    ["如何申请美国 NIW 移民", undefined, "zh-CN"],
    ["東京 の 天気", undefined, "ja"],
    ["서울 날씨", undefined, "ko"],
    ["погода в москве", undefined, "all"],
    ["如何申请", "en", "en"],
  ])("%s", (query, explicit, expected) => {
    expect(searchLanguage(query, explicit)).toBe(expected);
  });
});

describe("site: terms", () => {
  const hit = (url: string) => ({ title: url, url, snippet: "", engines: [] });
  const urls = (query: string, list: string[]) =>
    shapeResults(list.map(hit), 10, query).map((r) => r.url);

  it("keeps only results from that site, its subdomains included", () => {
    expect(
      urls("site:postgresql.org release", [
        "https://www.postgresql.org/docs/",
        "https://jdbc.postgresql.org/x",
        "https://merriam-webster.com/release",
        "https://notpostgresql.org/x",
      ]),
    ).toEqual(["https://www.postgresql.org/docs/", "https://jdbc.postgresql.org/x"]);
  });

  it("honours a path, and several sites", () => {
    expect(
      urls("site:a.example/news site:b.example x", [
        "https://a.example/news/1",
        "https://a.example/other",
        "https://b.example/anything",
      ]),
    ).toEqual(["https://a.example/news/1", "https://b.example/anything"]);
  });

  it("leaves other queries alone, including an excluded site", () => {
    const list = ["https://a.example/", "https://b.example/"];
    expect(urls("plain query", list)).toEqual(list);
    expect(urls("query -site:a.example", list)).toEqual(list);
  });
});

describe("a narrow category that finds too little", () => {
  const hit = (url: string) => ({ title: url, url, snippet: "", engines: ["x"] });
  function provider(byCategory: Record<string, SearchHit[] | Error>) {
    const calls: string[] = [];
    const p: SearchProvider = {
      name: "fake",
      health: () => Promise.resolve("ok"),
      search: (q: SearchQuery) => {
        calls.push(q.category);
        const r = byCategory[q.category] ?? [];
        return r instanceof Error
          ? Promise.reject(r)
          : Promise.resolve({ results: r, suggestions: [] });
      },
    };
    return {
      calls,
      service: new SearchService(p, { cacheTtlMs: 60_000, concurrency: 4, retryDelayMs: 0 }),
    };
  }

  it("is left alone when it finds enough", async () => {
    const { calls, service } = provider({
      it: [hit("https://a/"), hit("https://b/"), hit("https://c/")],
    });
    const out = await webSearch({ query: "x", category: "it" }, service);
    expect(calls).toEqual(["it"]);
    expect(out.logFields?.widened).toBeUndefined();
  });

  it("is filled in from a general search, without repeats", async () => {
    const { calls, service } = provider({
      it: [hit("https://a/")],
      general: [hit("https://a/"), hit("https://b/"), hit("https://c/")],
    });
    const out = await webSearch({ query: "x", category: "it" }, service);
    expect(calls).toEqual(["it", "general"]);
    expect(out.meta.results).toMatchObject([
      { url: "https://a/" },
      { url: "https://b/" },
      { url: "https://c/" },
    ]);
    expect(out.logFields?.widened).toBe(true);
  });

  it("still gets results when its own engines all failed", async () => {
    const { service } = provider({
      it: new ToolFailure("no engines", "error", { engine_errors: { github: "x" } }),
      general: [hit("https://a/")],
    });
    const out = await webSearch({ query: "x", category: "it" }, service);
    expect(out.meta.results).toMatchObject([{ url: "https://a/" }]);
  });

  it("logs the category it was asked for", async () => {
    const { service } = provider({ general: [hit("https://a/")] });
    const out = await webSearch({ query: "x", time_range: "week" }, service);
    expect(out.logFields).toMatchObject({ category: "general", time_range: "week" });
  });
});
