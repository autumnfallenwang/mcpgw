import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../src/lib/cache.js";
import { Limiter, QueueTimeout } from "../src/lib/limiter.js";
import { Pacer } from "../src/lib/pacer.js";
import { createSearxngProvider, engineQuery } from "../src/search/searxng.js";
import { SearchService } from "../src/search/service.js";
import type { SearchOutcome, SearchProvider, SearchQuery } from "../src/search/types.js";
import { ToolFailure } from "../src/tools/result.js";

const QUERY: SearchQuery = { query: "gold", maxResults: 5, category: "general", language: "en" };

describe("TtlCache", () => {
  it("expires entries and drops the least recently used", () => {
    let now = 0;
    const cache = new TtlCache<number>(100, 2, () => now);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "b" is now the oldest
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    now = 200;
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("Limiter", () => {
  it("never runs more than the cap at once", async () => {
    const limiter = new Limiter(2, 1000);
    let running = 0;
    let peak = 0;
    await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        limiter.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("fails a call that waits too long, then keeps working", async () => {
    const limiter = new Limiter(1, 10);
    let finish = () => {};
    const slow = limiter.run(() => new Promise<void>((r) => (finish = r)));
    await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(QueueTimeout);
    finish();
    await slow;
    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("releases the slot when a call throws", async () => {
    const limiter = new Limiter(1, 10);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("Pacer", () => {
  afterEach(() => vi.useRealTimers());

  it("spaces a burst out, in the order it arrived", async () => {
    vi.useFakeTimers();
    const pacer = new Pacer(1000, 30_000);
    const done: number[] = [];
    const calls = [0, 1, 2].map((n) => pacer.wait().then(() => done.push(n)));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(calls);
    expect(done).toEqual([0, 1, 2]);
  });

  it("doesn't delay a call once the gap has passed", async () => {
    vi.useFakeTimers();
    const pacer = new Pacer(1000, 30_000);
    await pacer.wait();
    await vi.advanceTimersByTimeAsync(5000);
    let ran = false;
    void pacer.wait().then(() => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toBe(true);
  });

  it("refuses a call that would wait too long, without using up a turn", async () => {
    vi.useFakeTimers();
    const pacer = new Pacer(1000, 1500);
    void pacer.wait();
    void pacer.wait();
    await expect(pacer.wait()).rejects.toBeInstanceOf(QueueTimeout);
    await vi.advanceTimersByTimeAsync(2000);
    let ran = false;
    void pacer.wait().then(() => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toBe(true);
  });

  it("does nothing with no gap", async () => {
    const pacer = new Pacer(0, 0);
    await pacer.wait();
    await pacer.wait();
  });
});

describe("SearchService", () => {
  function counting(outcome: SearchOutcome | Error) {
    const provider: SearchProvider & { calls: number } = {
      name: "test",
      calls: 0,
      search() {
        provider.calls++;
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
      health: () => Promise.resolve("ok"),
    };
    return provider;
  }
  const same = <T>(x: T) => x;

  it("spaces searches out, but not ones the cache can answer", async () => {
    vi.useFakeTimers();
    try {
      const provider = counting({
        results: [{ title: "A", url: "https://a.example/", snippet: "", engines: [] }],
        suggestions: [],
      });
      const service = new SearchService(provider, {
        cacheTtlMs: 60_000,
        concurrency: 4,
        minGapMs: 1000,
      });
      const first = service.search(QUERY, same);
      const second = service.search({ ...QUERY, query: "silver" }, same);
      await vi.advanceTimersByTimeAsync(0);
      expect(provider.calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(provider.calls).toBe(2);
      await Promise.all([first, second]);
      expect((await service.search(QUERY, same)).cached).toBe(true);
      expect(provider.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when too many searches are waiting", async () => {
    const provider = counting({ results: [], suggestions: [] });
    const service = new SearchService(provider, {
      cacheTtlMs: 60_000,
      concurrency: 4,
      minGapMs: 60_000,
      maxPaceWaitMs: 10,
    });
    void service.search(QUERY, same, { retryEmpty: false });
    await expect(service.search({ ...QUERY, query: "silver" }, same)).rejects.toThrow(
      "Too many searches",
    );
  });

  it("serves identical arguments from the cache, and different ones fresh", async () => {
    const provider = counting({
      results: [{ title: "A", url: "https://a.example/", snippet: "", engines: [] }],
      suggestions: [],
    });
    const service = new SearchService(provider, { cacheTtlMs: 60_000, concurrency: 1 });
    expect((await service.search(QUERY, same)).cached).toBe(false);
    expect((await service.search(QUERY, same)).cached).toBe(true);
    expect((await service.search({ ...QUERY, language: "de" }, same)).cached).toBe(false);
    expect(provider.calls).toBe(2);
  });

  it("tries an empty result once more, and never caches it", async () => {
    const provider = counting({ results: [], suggestions: [] });
    const service = new SearchService(provider, {
      cacheTtlMs: 60_000,
      concurrency: 1,
      retryDelayMs: 0,
    });
    const first = await service.search(QUERY, same);
    expect(first.retried).toBe(true);
    expect(first.cached).toBe(false);
    expect(provider.calls).toBe(2);
    expect((await service.search(QUERY, same)).cached).toBe(false);
    expect(provider.calls).toBe(4);
  });

  it("keeps what the second try finds", async () => {
    let calls = 0;
    const provider: SearchProvider = {
      name: "flaky",
      health: () => Promise.resolve("ok"),
      search: () => {
        calls++;
        return Promise.resolve({
          results:
            calls === 1
              ? []
              : [{ title: "A", url: "https://a.example/", snippet: "", engines: [] }],
          suggestions: [],
        });
      },
    };
    const service = new SearchService(provider, {
      cacheTtlMs: 60_000,
      concurrency: 1,
      retryDelayMs: 0,
    });
    const found = await service.search(QUERY, same);
    expect(found.results).toHaveLength(1);
    expect(found.retried).toBe(true);
    expect((await service.search(QUERY, same)).cached).toBe(true);
  });

  it("tries again when no engine answered, then says so", async () => {
    const provider = counting(
      new ToolFailure("no engines", "error", { engine_errors: { a: "b" } }),
    );
    const service = new SearchService(provider, {
      cacheTtlMs: 60_000,
      concurrency: 1,
      retryDelayMs: 0,
    });
    await expect(service.search(QUERY, same)).rejects.toThrow("no engines");
    expect(provider.calls).toBe(2);
  });

  it("doesn't cache a failure", async () => {
    const provider = counting(new ToolFailure("down", "error"));
    const service = new SearchService(provider, { cacheTtlMs: 60_000, concurrency: 1 });
    await expect(service.search(QUERY, same)).rejects.toBeInstanceOf(ToolFailure);
    await expect(service.search(QUERY, same)).rejects.toBeInstanceOf(ToolFailure);
    expect(provider.calls).toBe(2);
  });
});

describe("engineQuery", () => {
  it.each([
    // From the 2026-11-10 meeting.
    [
      "site:kubernetes.io/blog Kubernetes v1.37.2 OR site:github.com/kubernetes/kubernetes/releases/tag/v1.37.2",
      "site:kubernetes.io blog Kubernetes v1.37.2 OR site:github.com kubernetes kubernetes releases tag v1.37.2",
    ],
    ["latest site:https://docs.k3s.io/release-notes/", "latest site:docs.k3s.io release-notes"],
    [
      "site:github.com/k3s-io/k3s/releases?q=v1.37%2Bk3s1",
      "site:github.com k3s-io k3s releases q v1.37+k3s1",
    ],
    // Left alone: a bare domain, an excluded site, a quoted URL, and broken percent-encoding.
    ["site:docs.k3s.io release notes", "site:docs.k3s.io release notes"],
    ["k3s -site:reddit.com/r/kubernetes", "k3s -site:reddit.com/r/kubernetes"],
    [
      '"modelcontextprotocol.io/specification" latest',
      '"modelcontextprotocol.io/specification" latest',
    ],
    ["site:a.example/100%", "site:a.example 100%"],
  ])("%s", (query, expected) => {
    expect(engineQuery(query)).toBe(expected);
  });
});

describe("SearXNG provider, against a fake SearXNG", () => {
  let server: Server;
  let base: string;
  let reply: { status: number; body: unknown; delayMs?: number };
  let lastUrl: URL;
  let lastCookie: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastUrl = new URL(req.url ?? "/", "http://x");
      lastCookie = req.headers.cookie;
      if (lastUrl.pathname === "/healthz") {
        res.writeHead(reply.status).end("OK");
        return;
      }
      setTimeout(() => {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const signal = () => AbortSignal.timeout(1000);

  it("leaves out an engine that refused, until it returns results again", async () => {
    const provider = createSearxngProvider(base);
    const hit = (engine: string) => ({
      title: "A",
      url: `https://${engine}.example/`,
      engines: [engine],
    });
    reply = {
      status: 200,
      body: {
        results: [hit("yahoo")],
        unresponsive_engines: [
          ["duckduckgo", "CAPTCHA"],
          ["bing news", "too many requests"],
          ["wikipedia", "timeout"],
        ],
      },
    };
    await provider.search(QUERY, signal());
    expect(lastCookie).toBeUndefined();
    reply = { status: 200, body: { results: [hit("yahoo")], unresponsive_engines: [] } };
    await provider.search(QUERY, signal());
    // A timeout isn't a refusal, so wikipedia is still asked.
    expect(lastCookie).toContain("duckduckgo__general");
    expect(lastCookie).toContain("bing news__news");
    expect(lastCookie).not.toContain("wikipedia");
    expect(lastCookie).toMatch(/^disabled_engines="[^"]+"$/);
    const issues = provider.engineIssues?.() ?? [];
    expect(issues.find((i) => i.engine === "duckduckgo")?.pausedUntil).toBeDefined();
    expect(issues.find((i) => i.engine === "wikipedia")?.pausedUntil).toBeUndefined();

    reply = { status: 200, body: { results: [hit("duckduckgo")], unresponsive_engines: [] } };
    await provider.search(QUERY, signal());
    await provider.search(QUERY, signal());
    expect(lastCookie).not.toContain("duckduckgo");
    expect(lastCookie).toContain("bing news__news");
  });

  it("leaves out an engine that timed out 3 times in a row, but not one that timed out once", async () => {
    const provider = createSearxngProvider(base);
    const answer = (results: string[], failing: [string, string][]) => ({
      status: 200,
      body: {
        results: results.map((e) => ({ title: "A", url: `https://${e}.example/`, engines: [e] })),
        unresponsive_engines: failing,
      },
    });
    reply = answer(
      ["yahoo"],
      [
        ["bing", "timeout"],
        ["duckduckgo", "timeout"],
      ],
    );
    await provider.search(QUERY, signal());
    reply = answer(
      ["bing"],
      [
        ["duckduckgo", "Suspended: timeout"],
        ["wikipedia", "HTTP error"],
      ],
    );
    await provider.search(QUERY, signal());
    reply = answer(
      ["yahoo"],
      [
        ["bing", "timeout"],
        ["duckduckgo", "timeout"],
      ],
    );
    await provider.search(QUERY, signal());
    reply = answer(["yahoo"], []);
    await provider.search(QUERY, signal());
    expect(lastCookie).toContain("duckduckgo__general");
    // Bing answered in between, so its two timeouts weren't in a row.
    expect(lastCookie).not.toContain("bing__");
    expect(lastCookie).not.toContain("wikipedia__");
  });

  it("keeps an engine that answers odd queries with an HTTP error, since that costs no time", async () => {
    const provider = createSearxngProvider(base);
    for (let n = 0; n < 4; n++) {
      reply = {
        status: 200,
        body: {
          results: [{ title: "A", url: "https://a.example/", engines: ["yahoo"] }],
          unresponsive_engines: [["wikipedia", n === 0 ? "HTTP error" : "Suspended: HTTP error"]],
        },
      };
      await provider.search(QUERY, signal());
    }
    expect(lastCookie).toBeUndefined();
  });

  it("doubles the pause each time an engine refuses again, up to an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const provider = createSearxngProvider(base);
      const refuse = {
        status: 200,
        body: {
          results: [{ title: "A", url: "https://a.example/", engines: ["yahoo"] }],
          unresponsive_engines: [["duckduckgo", "CAPTCHA"]],
        },
      };
      const paused = () =>
        (Date.parse(provider.engineIssues?.()[0]?.pausedUntil ?? "") - Date.now()) / 60_000;
      const minutes: number[] = [];
      for (let n = 0; n < 6; n++) {
        reply = refuse;
        await provider.search(QUERY, signal());
        minutes.push(Math.round(paused()));
        vi.setSystemTime(Date.now() + 61 * 60_000);
      }
      expect(minutes).toEqual([5, 10, 20, 40, 60, 60]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks news dates itself, since a time range would make SearXNG skip most news engines", async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    reply = {
      status: 200,
      body: {
        results: [
          { title: "Today", url: "https://a.example/", publishedDate: daysAgo(0) },
          { title: "Last night", url: "https://b.example/", publishedDate: daysAgo(1) },
          { title: "Last month", url: "https://c.example/", publishedDate: daysAgo(30) },
          { title: "No date", url: "https://d.example/", publishedDate: null },
        ],
        unresponsive_engines: [],
      },
    };
    const provider = createSearxngProvider(base);
    const day = await provider.search({ ...QUERY, timeRange: "day", category: "news" }, signal());
    expect(lastUrl.searchParams.has("time_range")).toBe(false);
    expect(day.results.map((r) => r.title)).toEqual(["Today", "Last night", "No date"]);
    const any = await provider.search({ ...QUERY, category: "news" }, signal());
    expect(any.results).toHaveLength(4);
  });

  it("sends the arguments and maps the results", async () => {
    reply = {
      status: 200,
      body: {
        results: [
          {
            title: " A ",
            url: "https://a.example/",
            content: "text",
            engines: ["bing"],
            publishedDate: "2026-09-25T10:00:00",
          },
          { title: "No date", url: "https://b.example/", content: null, publishedDate: null },
          { title: "Not a web link", url: "magnet:?xt=abc" },
        ],
        suggestions: ["more gold"],
        unresponsive_engines: [],
      },
    };
    const provider = createSearxngProvider(base);
    const out = await provider.search({ ...QUERY, timeRange: "week", category: "it" }, signal());
    expect(Object.fromEntries(lastUrl.searchParams)).toEqual({
      q: "gold",
      format: "json",
      language: "en",
      categories: "it",
      time_range: "week",
    });
    expect(out.results).toEqual([
      {
        title: "A",
        url: "https://a.example/",
        snippet: "text",
        engines: ["bing"],
        published: "2026-09-25",
      },
      { title: "No date", url: "https://b.example/", snippet: "", engines: [] },
    ]);
    expect(out.suggestions).toEqual(["more gold"]);
  });

  it("asks the engines for a bare domain after site:, with the path as words", async () => {
    reply = { status: 200, body: { results: [] } };
    const provider = createSearxngProvider(base);
    await provider.search(
      { ...QUERY, query: "site:github.com/k3s-io/k3s/releases latest release" },
      signal(),
    );
    expect(lastUrl.searchParams.get("q")).toBe(
      "site:github.com k3s-io k3s releases latest release",
    );
  });

  it("keeps results when only some engines failed", async () => {
    reply = {
      status: 200,
      body: {
        results: [{ title: "A", url: "https://a.example/" }],
        unresponsive_engines: [["google", "access denied"]],
      },
    };
    const out = await createSearxngProvider(base).search(QUERY, signal());
    expect(out.results).toHaveLength(1);
  });

  it("remembers failing engines for the status page, and forgets them after an hour", async () => {
    const provider = createSearxngProvider(base);
    expect(provider.engineIssues?.()).toEqual([]);
    reply = {
      status: 200,
      body: {
        results: [{ title: "A", url: "https://a.example/" }],
        unresponsive_engines: [["brave", "too many requests"]],
      },
    };
    await provider.search(QUERY, signal());
    await provider.search(QUERY, signal());
    expect(provider.engineIssues?.()).toMatchObject([
      { engine: "brave", reason: "too many requests", count: 2 },
    ]);

    const later = Date.now() + 61 * 60 * 1000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect(provider.engineIssues?.()).toEqual([]);
      await provider.search(QUERY, signal());
      expect(provider.engineIssues?.()).toMatchObject([{ engine: "brave", count: 1 }]);
    } finally {
      clock.mockRestore();
    }
  });

  it("treats nothing found as a normal empty result", async () => {
    reply = { status: 200, body: { results: [], unresponsive_engines: [] } };
    await expect(createSearxngProvider(base).search(QUERY, signal())).resolves.toEqual({
      results: [],
      suggestions: [],
    });
  });

  it("says so when no results is because every engine failed", async () => {
    reply = {
      status: 200,
      body: { results: [], unresponsive_engines: [["google", "access denied"]] },
    };
    await expect(createSearxngProvider(base).search(QUERY, signal())).rejects.toMatchObject({
      status: "error",
      message: expect.stringContaining("didn't answer"),
    });
  });

  it("turns a backend error into a tool failure", async () => {
    reply = { status: 500, body: "oops" };
    await expect(createSearxngProvider(base).search(QUERY, signal())).rejects.toMatchObject({
      status: "error",
      message: expect.stringContaining("isn't answering"),
    });
  });

  it("turns a garbled response into a tool failure", async () => {
    reply = { status: 200, body: "<html>not json</html>" };
    await expect(createSearxngProvider(base).search(QUERY, signal())).rejects.toBeInstanceOf(
      ToolFailure,
    );
  });

  it("reports a timeout as a timeout", async () => {
    reply = { status: 200, body: { results: [] }, delayMs: 200 };
    await expect(
      createSearxngProvider(base).search(QUERY, AbortSignal.timeout(20)),
    ).rejects.toMatchObject({ status: "timeout" });
  });

  it("reports an unreachable backend as a tool failure", async () => {
    await expect(
      createSearxngProvider("http://127.0.0.1:1").search(QUERY, signal()),
    ).rejects.toMatchObject({ status: "error" });
  });

  it("checks health", async () => {
    reply = { status: 200, body: "" };
    await expect(createSearxngProvider(base).health()).resolves.toBe("ok");
    reply = { status: 503, body: "" };
    await expect(createSearxngProvider(base).health()).resolves.toBe("down");
    await expect(createSearxngProvider("http://127.0.0.1:1").health()).resolves.toBe("down");
  });
});
