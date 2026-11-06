import { describe, expect, it } from "vitest";
import type { SearchProvider, SearchQuery } from "../src/search/types.js";
import { formatSearchText, shapeResults, webSearch } from "../src/tools/web-search.js";

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
    expect(text).toContain("Try different words");
  });
});

describe("shapeResults", () => {
  it("merges the same URL from several engines", () => {
    const shaped = shapeResults(
      {
        results: [hit("https://a.example/", ["bing"]), hit("https://a.example/", ["google"])],
        suggestions: [],
      },
      5,
    );
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.engines).toEqual(["bing", "google"]);
  });

  it("cuts snippets to 300 characters and collapses whitespace", () => {
    const [shaped] = shapeResults(
      {
        results: [{ ...hit("https://a.example/"), snippet: `a  \n b ${"x".repeat(400)}` }],
        suggestions: [],
      },
      5,
    );
    expect(shaped?.snippet.length).toBeLessThanOrEqual(300);
    expect(shaped?.snippet.startsWith("a b x")).toBe(true);
    expect(shaped?.snippet.endsWith("…")).toBe(true);
  });

  it("keeps to max_results", () => {
    const results = [1, 2, 3].map((n) => hit(`https://a.example/${n}`));
    expect(shapeResults({ results, suggestions: [] }, 2)).toHaveLength(2);
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
    const output = await webSearch({ query: "x" }, provider, AbortSignal.timeout(1000));
    expect(seen).toEqual({ query: "x", maxResults: 5, category: "general", language: "en" });
    expect(output.logFields).toMatchObject({ query: "x", results: 0, cached: false });
  });
});
