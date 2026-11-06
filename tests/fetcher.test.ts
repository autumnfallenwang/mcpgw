import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Fetcher, FetchFailure, HttpFailure, type LookupFn } from "../src/fetch/fetcher.js";
import { BlockedUrl, DEFAULT_POLICY, type FetchPolicy } from "../src/fetch/guard.js";

let server: Server;
let port: number;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    seen.push(path);
    const html = { "content-type": "text/html; charset=utf-8" };
    if (path === "/page") return void res.writeHead(200, html).end("<p>hello</p>");
    if (path === "/headers") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify(req.headers));
    }
    if (path === "/gzip") {
      res.writeHead(200, { ...html, "content-encoding": "gzip" });
      return void res.end(gzipSync("<p>compressed</p>"));
    }
    if (path === "/bomb") {
      res.writeHead(200, { ...html, "content-encoding": "gzip" });
      return void res.end(gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61)));
    }
    if (path === "/big") {
      res.writeHead(200, html);
      return void res.end(Buffer.alloc(2 * 1024 * 1024, 0x61));
    }
    if (path === "/exact") {
      res.writeHead(200, html);
      return void res.end(Buffer.alloc(1024, 0x61));
    }
    if (path === "/slow-headers") return; // never answers
    if (path === "/slow-body") {
      res.writeHead(200, html);
      return void res.write("<p>start");
    }
    if (path === "/404") return void res.writeHead(404).end("nope");
    if (path === "/403") return void res.writeHead(403).end("nope");
    if (path === "/500") return void res.writeHead(500).end("nope");
    if (path === "/to-page") return void res.writeHead(302, { location: "/page" }).end();
    if (path === "/chain") return void res.writeHead(301, { location: "/chain-2" }).end();
    if (path === "/chain-2") return void res.writeHead(307, { location: "/page" }).end();
    if (path === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (path === "/no-location") return void res.writeHead(302).end();
    if (path === "/to-private") {
      return void res.writeHead(302, { location: "http://192.168.1.163/secret" }).end();
    }
    if (path === "/to-metadata") {
      return void res.writeHead(302, { location: "http://169.254.169.254/latest/" }).end();
    }
    if (path === "/to-internal") {
      return void res.writeHead(302, { location: "http://llmgw.arch.internal/v1/models" }).end();
    }
    if (path === "/to-file")
      return void res.writeHead(302, { location: "file:///etc/passwd" }).end();
    if (path === "/to-rebind") {
      return void res.writeHead(302, { location: `http://evil.test:${port}/page` }).end();
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

/** The real rules, except that the test server's own address and port count as public. */
const TEST_POLICY: FetchPolicy = {
  ...DEFAULT_POLICY(250),
  isAllowedAddress: (ip) => ip === "127.0.0.1" || DEFAULT_POLICY(250).isAllowedAddress(ip),
  isAllowedPort: () => true,
};

function fetcher(overrides: Partial<ConstructorParameters<typeof Fetcher>[0]> = {}) {
  return new Fetcher({ policy: TEST_POLICY, timeoutMs: 1000, maxBytes: 1024 * 1024, ...overrides });
}

/** A DNS server that answers with whatever the test wants. */
function fakeDns(answers: string | string[]): LookupFn {
  const list = Array.isArray(answers) ? answers : [answers];
  return ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options?.all) {
      callback(
        null,
        list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      );
    } else {
      callback(null, list[0], list[0]?.includes(":") ? 6 : 4);
    }
  }) as unknown as LookupFn;
}

const url = (path: string) => `http://127.0.0.1:${port}${path}`;

describe("reading pages", () => {
  it("reads a page and reports its type", async () => {
    const page = await fetcher().fetch(url("/page"));
    expect(page.body.toString()).toBe("<p>hello</p>");
    expect(page.contentType).toBe("text/html");
    expect(page.partial).toBe(false);
    expect(page.finalUrl.href).toBe(url("/page"));
  });

  it("sends plain requests that prefer Markdown, with no cookies", async () => {
    const page = await fetcher().fetch(url("/headers"));
    const headers = JSON.parse(page.body.toString());
    expect(headers.accept).toMatch(/^text\/markdown, text\/html;q=0\.9/);
    expect(headers["user-agent"]).toMatch(/^mcpgw\/\S+ \(home tool gateway\)$/);
    expect(headers.cookie).toBeUndefined();
  });

  it("decompresses", async () => {
    const page = await fetcher().fetch(url("/gzip"));
    expect(page.body.toString()).toBe("<p>compressed</p>");
  });
});

describe("limits", () => {
  it("stops reading at the size limit", async () => {
    const page = await fetcher().fetch(url("/big"));
    expect(page.bytes).toBe(1024 * 1024);
    expect(page.partial).toBe(true);
  });

  it("counts decompressed size, so a zip bomb stops at the limit", async () => {
    const page = await fetcher().fetch(url("/bomb"));
    expect(page.bytes).toBe(1024 * 1024);
    expect(page.partial).toBe(true);
  });

  it("isn't fooled by a body exactly at the limit", async () => {
    const page = await fetcher({ maxBytes: 1024 }).fetch(url("/exact"));
    expect(page.bytes).toBe(1024);
    expect(page.partial).toBe(false);
  });

  it("times out when a server never answers", async () => {
    const err = await fetcher({ timeoutMs: 50 })
      .fetch(url("/slow-headers"))
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("timeout");
  });

  it("times out when a body never finishes", async () => {
    const err = await fetcher({ timeoutMs: 50 })
      .fetch(url("/slow-body"))
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("timeout");
  });
});

describe("errors", () => {
  it.each([404, 403, 500])("reports HTTP %i", async (status) => {
    const err = await fetcher()
      .fetch(url(`/${status}`))
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpFailure);
    expect(err.status).toBe(status);
  });

  it("reports a name that doesn't resolve", async () => {
    const missing: LookupFn = ((_h: string, _o: unknown, cb: (e: Error) => void) => {
      cb(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    }) as unknown as LookupFn;
    const err = await fetcher({ lookup: missing })
      .fetch("http://nope.example/")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("dns");
  });

  it("reports a refused connection", async () => {
    const err = await fetcher()
      .fetch("http://127.0.0.1:1/")
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("connect");
  });
});

describe("redirects: every hop is checked again", () => {
  it("follows a redirect and reports the final URL", async () => {
    const page = await fetcher().fetch(url("/to-page"));
    expect(page.body.toString()).toBe("<p>hello</p>");
    expect(page.finalUrl.pathname).toBe("/page");
  });

  it("follows a chain", async () => {
    const page = await fetcher().fetch(url("/chain"));
    expect(page.finalUrl.pathname).toBe("/page");
  });

  it("gives up after 5 redirects", async () => {
    const err = await fetcher()
      .fetch(url("/loop"))
      .catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("too_many_redirects");
  });

  it("reports a redirect with nowhere to go", async () => {
    const err = await fetcher()
      .fetch(url("/no-location"))
      .catch((e) => e);
    expect(err.kind).toBe("bad_redirect");
  });

  it.each([
    ["/to-private", /private address 192\.168\.1\.163/],
    ["/to-metadata", /private address 169\.254\.169\.254/],
    ["/to-internal", /internal name llmgw\.arch\.internal/],
    ["/to-file", /scheme file/],
  ])("refuses %s", async (path, reason) => {
    const err = await fetcher()
      .fetch(url(path))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrl);
    expect(err.message).toMatch(reason);
  });

  it("refuses a redirect to a name that resolves somewhere private", async () => {
    const dns = ((host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      const address = host === "evil.test" ? "10.0.0.1" : "127.0.0.1";
      if (options?.all) cb(null, [{ address, family: 4 }]);
      else cb(null, address, 4);
    }) as unknown as LookupFn;
    const err = await fetcher({ lookup: dns })
      .fetch(`http://start.test:${port}/to-rebind`)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrl);
    expect(err.message).toMatch(/evil\.test resolves to private address 10\.0\.0\.1/);
  });
});

describe("addresses, checked at connect time with the real rules", () => {
  const real = (dns: LookupFn) =>
    new Fetcher({
      policy: { ...DEFAULT_POLICY(250), isAllowedPort: () => true },
      timeoutMs: 1000,
      maxBytes: 1024,
      lookup: dns,
    });

  it.each([
    "192.168.1.163",
    "10.43.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
  ])("refuses a public-looking name that resolves to %s", async (ip) => {
    const err = await real(fakeDns(ip))
      .fetch(`http://rebind.test:${port}/page`)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrl);
    expect(err.message).toContain("resolves to private address");
  });

  it("refuses a name with one public and one private answer", async () => {
    const err = await real(fakeDns(["8.8.8.8", "192.168.1.163"]))
      .fetch(`http://mixed.test:${port}/page`)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrl);
  });

  it("never connects to the refused address", async () => {
    seen.length = 0;
    await real(fakeDns("127.0.0.1"))
      .fetch(`http://rebind.test:${port}/page`)
      .catch(() => {});
    expect(seen).toEqual([]);
  });

  it("refuses an IP written in the URL, which skips the lookup", async () => {
    seen.length = 0;
    const err = await real(fakeDns("8.8.8.8"))
      .fetch(`http://127.0.0.1:${port}/page`)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrl);
    expect(seen).toEqual([]);
  });
});
