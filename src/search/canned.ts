import type { SearchOutcome, SearchProvider, SearchQuery } from "./types.js";

/** Fixed results, for proving the network path before a real backend exists. */
export const cannedProvider: SearchProvider = {
  name: "canned",
  search(query: SearchQuery): Promise<SearchOutcome> {
    return Promise.resolve({
      results: [
        {
          title: "mcpgw test result",
          url: "https://example.com/",
          snippet: `A canned result for "${query.query}". mcpgw has no real search backend yet.`,
          engines: ["canned"],
        },
      ],
      suggestions: [],
    });
  },
  health: () => Promise.resolve("ok"),
};
