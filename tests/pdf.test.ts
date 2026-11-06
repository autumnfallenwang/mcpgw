import { afterAll, describe, expect, it } from "vitest";
import { isPdf, stripMarkdownLinks } from "../src/fetch/extract.js";
import { ExtractFailure, ExtractorPool } from "../src/fetch/extractor-pool.js";
import { pdfBomb, pdfWithText } from "./pdf-fixture.js";

const pool = new ExtractorPool({ timeoutMs: 15_000, maxRssMb: 16_384 });
afterAll(() => pool.close());

const job = (bytes: Buffer, finalUrl = "https://x.example/files/report.pdf") => ({
  bytes: new Uint8Array(bytes),
  contentType: "application/pdf",
  finalUrl,
});

describe("reading a PDF", () => {
  it("returns its text and its title", async () => {
    const page = await pool.run(job(pdfWithText("Cat. No. 10231X", "Form W-9")));
    expect(page.text).toContain("Cat. No. 10231X");
    expect(page.title).toBe("Form W-9");
  });

  it("falls back to the file name for a title", async () => {
    const page = await pool.run(job(pdfWithText("Some text")));
    expect(page.title).toBe("report.pdf");
  });

  it("removes invisible characters, like any other page", async () => {
    const page = await pool.run(job(pdfWithText("Vis\\256ible")));
    expect(page.text).not.toMatch(/­/);
  });

  it("rejects something that isn't really a PDF, and still works after", async () => {
    await expect(pool.run(job(Buffer.from("%PDF-1.7 not really")))).rejects.toBeInstanceOf(
      ExtractFailure,
    );
    expect((await pool.run(job(pdfWithText("Still fine")))).text).toContain("Still fine");
  });
});

describe("recognising a PDF", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7");
  it.each([
    ["application/pdf", bytes, true],
    ["application/x-pdf", bytes, true],
    ["application/octet-stream", bytes, true],
    ["", bytes, true],
    ["application/octet-stream", new TextEncoder().encode("PK.."), false],
    ["text/html", bytes, false],
  ])("%s", (contentType, data, expected) => {
    expect(isPdf({ contentType, bytes: data })).toBe(expected);
  });
});

describe("a PDF bomb", () => {
  it("costs only its own request, however little it weighs", async () => {
    const start = process.memoryUsage.rss() / 1024 / 1024;
    const small = new ExtractorPool({
      size: 1,
      timeoutMs: 30_000,
      maxRssMb: Math.ceil(start) + 150,
    });
    try {
      const bomb = pdfBomb(1024);
      expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
      const failure = await small.run(job(bomb)).catch((e) => e);
      expect(failure).toBeInstanceOf(ExtractFailure);
      expect(failure.kind).toBe("memory");
    } finally {
      await small.close();
    }
  }, 60_000);

  it("doesn't turn away the next page while memory comes back down", async () => {
    // Already over the limit before it starts, as just after a bomb. Not growing, so it's fine.
    const tight = new ExtractorPool({ size: 1, timeoutMs: 15_000, maxRssMb: 1 });
    try {
      const page = await tight.run({
        bytes: new TextEncoder().encode("plain text, nothing heavy"),
        contentType: "text/plain",
        finalUrl: "https://x.example/a.txt",
      });
      expect(page.text).toContain("plain text");
    } finally {
      await tight.close();
    }
  });
});

describe("stripMarkdownLinks", () => {
  it.each([
    ["See [the docs](https://x.example/a).", "See the docs."],
    ["[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) rest", "Foo rest"],
    ['[a](https://x.example "title") b', "a b"],
    ["![alt](https://x.example/i.png)text", "text"],
    ["no links [here] (at all)", "no links [here] (at all)"],
  ])("%s", (input, expected) => {
    expect(stripMarkdownLinks(input)).toBe(expected);
  });
});
