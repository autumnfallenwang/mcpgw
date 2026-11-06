import { afterAll, describe, expect, it } from "vitest";
import { extractDocument } from "../src/fetch/extract.js";
import { ExtractFailure, ExtractorPool } from "../src/fetch/extractor-pool.js";

const encode = (text: string) => new TextEncoder().encode(text);
const html = (text: string) => ({
  bytes: encode(text),
  contentType: "text/html",
  finalUrl: "https://example.com/",
});
const plain = (text: string) => ({
  bytes: encode(text),
  contentType: "text/plain",
  finalUrl: "https://example.com/notes.txt",
});

const pool = new ExtractorPool({ timeoutMs: 5_000 });
afterAll(() => pool.close());

/** How long the main thread stayed stuck while `fn` ran. */
async function worstStall(fn: () => Promise<unknown>): Promise<number> {
  let last = performance.now();
  let worst = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 5);
  await fn().catch(() => {});
  clearInterval(tick);
  return worst;
}

describe("extractDocument", () => {
  it("decodes the charset the header names", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1
    const page = extractDocument({
      bytes,
      contentType: "text/plain",
      charset: "iso-8859-1",
      finalUrl: "https://example.com/a.txt",
    });
    expect(page.text).toBe("café");
  });

  it("decodes the charset an HTML page declares itself", () => {
    const head = encode('<html><head><meta charset="shift_jis"></head><body><p>');
    const kana = new Uint8Array([0x82, 0xa0]); // "あ" in Shift JIS
    const tail = encode("</p></body></html>");
    const bytes = new Uint8Array([...head, ...kana, ...tail]);
    const page = extractDocument({ bytes, contentType: "text/html", finalUrl: "https://e.com/" });
    expect(page.text).toContain("あ");
  });

  it("falls back to UTF-8 for a charset it doesn't know", () => {
    const page = extractDocument({
      bytes: encode("plain"),
      contentType: "text/plain",
      charset: "not-a-charset",
      finalUrl: "https://example.com/a.txt",
    });
    expect(page.text).toBe("plain");
  });

  it("titles Markdown from its text and other files from their name", () => {
    const md = extractDocument({
      bytes: encode("# The title\n\nBody"),
      contentType: "text/markdown",
      finalUrl: "https://example.com/doc",
    });
    expect(md.title).toBe("The title");
    expect(extractDocument(plain("x")).title).toBe("notes.txt");
  });

  it("caps the text it keeps", () => {
    expect(extractDocument(plain("a".repeat(600_000))).text).toHaveLength(500_000);
  });
});

describe("ExtractorPool", () => {
  it("reads a page in a worker, and reuses the worker", async () => {
    const first = await pool.run(html("<html><body><p>Hello there</p></body></html>"));
    expect(first.text).toContain("Hello there");
    const second = await pool.run(plain("And again"));
    expect(second.text).toBe("And again");
  });

  it("runs many at once beyond its size", async () => {
    const pages = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pool.run(plain(`page ${i}`))),
    );
    expect(pages.map((p) => p.text)).toEqual(Array.from({ length: 8 }, (_, i) => `page ${i}`));
  });

  const row =
    '<div class="r"><span><a href="/x">Item</a> <b>some text</b> <i>more</i></span></div>\n';
  const HOSTILE: [string, () => ReturnType<typeof html>][] = [
    ["5 MB of tags", () => html(`<html><body>${row.repeat(60_000)}</body></html>`)],
    ["a million nested elements", () => html("<div>".repeat(1_000_000))],
    ["millions of unclosed comments", () => html("<!--".repeat(1_250_000))],
    ["millions of unclosed scripts", () => html("<script>".repeat(600_000))],
    ["5 MB of spaces", () => plain(" ".repeat(5 * 1024 * 1024))],
    ["5 MB of unclosed meta tags", () => html("<meta ".repeat(800_000))],
  ];

  it.each(HOSTILE)(
    "%s: fails or finishes within the limit, and never stalls other callers",
    async (_name, make) => {
      const hostile = new ExtractorPool({ size: 1, timeoutMs: 2_000 });
      const started = performance.now();
      let outcome: unknown;
      const stall = await worstStall(async () => {
        outcome = await hostile.run(make()).catch((e) => e);
      });
      expect(performance.now() - started).toBeLessThan(4_000);
      expect(stall).toBeLessThan(500);
      if (outcome instanceof Error) expect(outcome).toBeInstanceOf(ExtractFailure);
      // The pool carries on after throwing the worker away.
      await expect(hostile.run(plain("still here"))).resolves.toMatchObject({ text: "still here" });
      await hostile.close();
    },
    20_000,
  );

  it("fails a page over the time limit", async () => {
    const tight = new ExtractorPool({ size: 1, timeoutMs: 5 });
    const err = await tight
      .run(html(`<html><body>${row.repeat(60_000)}</body></html>`))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExtractFailure);
    expect(err.kind).toBe("timeout");
    await tight.close();
  });

  it("fails a page over the memory limit, and only that page", async () => {
    const small = new ExtractorPool({ size: 1, timeoutMs: 15_000, maxOldMb: 16 });
    const err = await small
      .run(html(`<html><body>${row.repeat(60_000)}</body></html>`))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExtractFailure);
    expect(err.kind).toBe("memory");
    await expect(small.run(plain("still here"))).resolves.toMatchObject({ text: "still here" });
    await small.close();
  }, 30_000);
});
