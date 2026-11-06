import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

export interface ExtractedPage {
  title: string;
  text: string;
}

export interface ExtractJob {
  bytes: Uint8Array;
  /** Without parameters, lower case. */
  contentType: string;
  /** The label from the Content-Type header, if it had one. */
  charset?: string;
  finalUrl: string;
  /** Keep link addresses in the text. Off by default: they're a median 23% of a page's text. */
  includeLinks?: boolean;
}

/**
 * Elements with no reading value. Also where instructions to a model get hidden, since readers of
 * the rendered page never see them. The spec requires tool outputs to be cleaned.
 */
const DROP_ELEMENTS =
  "script,style,noscript,template,iframe,object,embed,svg,canvas,link,meta,[hidden],[aria-hidden='true']";
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|font-size\s*:\s*0(?:px|em|rem|pt|%)?\s*(?:;|$))/i;

/**
 * Invisible Unicode: zero-width and bidi characters, tag characters and supplementary variation
 * selectors, all of which can carry text a human never sees. ZWNJ and ZWJ matter in a few scripts,
 * such as Persian, and go too: hidden text is the bigger risk here.
 */
const INVISIBLE =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: matching these characters is the point
  /[­᠎​-‏‪-‮⁠-⁤⁦-⁯﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(INVISIBLE, "")
      .replace(CONTROL, "")
      // The lookbehind keeps this linear: a long run of spaces is only ever tried from its start.
      .replace(/(?<![ \t])[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function createTurndown(baseUrl: string, includeLinks: boolean): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  // A rule rather than remove(): Turndown's own image rule would win over remove(), and an image URL
  // is noise a model can't read.
  turndown.addRule("noMedia", {
    filter: ["img", "picture", "video", "audio", "source"],
    replacement: () => "",
  });
  turndown.addRule("absoluteLinks", {
    filter: "a",
    replacement(content, node) {
      const label = content.trim();
      const href = (node as HTMLElement).getAttribute("href");
      if (!label) return "";
      if (!href || !includeLinks) return label;
      try {
        const url = new URL(href, baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") return label;
        return `[${label}](${url.href})`;
      } catch {
        return label;
      }
    },
  });
  return turndown;
}

/** Past this, Readability gives up and the page falls back to its plain text. */
const MAX_ELEMENTS = 100_000;
/** Markup left after removing scripts and styles. Real pages stay well under this. */
const MAX_MARKUP_CHARS = 2_000_000;
/** Far more than a model reads in a call. It keeps a cached page's memory bounded. */
export const MAX_TEXT_CHARS = 500_000;

const PAGE_FURNITURE =
  "nav,footer,aside,[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary']";
/** An "article" this short, from a page with this many times more text, is really a scrap. */
const SHORT_ARTICLE_CHARS = 1000;
const SCRAP_RATIO = 3;

/** The title of a Markdown document: its front matter's, or else its first top-level heading. */
export function markdownTitle(text: string): string | undefined {
  // Only the top of the document: the title is there, and these patterns needn't see a hostile rest.
  const top = text.slice(0, 4000);
  const front = /^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$[\s\S]*?^---$/m.exec(top);
  if (front?.index === 0 && front[1]) return front[1];
  return /^#\s+(.+)$/m.exec(top)?.[1]?.trim();
}

/** Main-content extraction, then Markdown-ish text: headings and lists stay, and links on request. */
export function extractHtml(html: string, baseUrl: string, includeLinks = false): ExtractedPage {
  // Most of a modern page's bytes are scripts and styles, so they go before anything is parsed.
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .slice(0, MAX_MARKUP_CHARS);
  // linkedom only builds <html> and <body> if the markup has them, and crashes reading them if not.
  const complete = /<html[\s>]/i.test(markup)
    ? markup
    : `<!doctype html><html><head></head><body>${markup}</body></html>`;
  const { document } = parseHTML(complete);

  const pageTitle = cleanText(document.querySelector("title")?.textContent ?? "");
  for (const el of document.querySelectorAll(DROP_ELEMENTS)) el.remove();
  for (const el of document.querySelectorAll("[style]")) {
    if (HIDDEN_STYLE.test(el.getAttribute("style") ?? "")) el.remove();
  }

  // Readability expects an article. On a home page or a list of links it keeps a scrap, so compare
  // against the page's own text below, without the parts no page is really about.
  for (const el of document.querySelectorAll(PAGE_FURNITURE)) el.remove();
  const wholePageHtml = document.body?.innerHTML ?? "";

  let contentHtml = "";
  let title = pageTitle;
  try {
    const article = new Readability(document as unknown as Document, {
      maxElemsToParse: MAX_ELEMENTS,
      charThreshold: 200,
    }).parse();
    if (article?.content) contentHtml = article.content;
    if (article?.title) title = cleanText(article.title);
  } catch {
    // Too many elements, or markup it can't handle: the whole page below still reads.
  }

  const turndown = createTurndown(baseUrl, includeLinks);
  let text = contentHtml ? cleanText(turndown.turndown(contentHtml)) : "";
  if (text.length < SHORT_ARTICLE_CHARS && wholePageHtml) {
    const whole = cleanText(turndown.turndown(wholePageHtml));
    if (whole.length > text.length * SCRAP_RATIO) text = whole;
  }
  return { title, text };
}

/** The charset a page declares in its first bytes. Older pages often only say it there. */
function declaredCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  return /<meta[^>]+charset=["']?\s*([a-zA-Z0-9_-]+)/i.exec(head)?.[1];
}

function decode(job: ExtractJob, isHtml: boolean): string {
  const label = job.charset ?? (isHtml ? declaredCharset(job.bytes) : undefined) ?? "utf-8";
  try {
    return new TextDecoder(label).decode(job.bytes);
  } catch {
    // A label TextDecoder doesn't know.
    return new TextDecoder("utf-8").decode(job.bytes);
  }
}

export const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const PDF_TYPES = new Set(["application/pdf", "application/x-pdf"]);
/** What servers that don't know a file's type send, PDFs included. */
const UNKNOWN_TYPES = new Set(["application/octet-stream", "binary/octet-stream", ""]);

/** By its declared type, or by its first bytes when the server doesn't say. */
export function isPdf(job: Pick<ExtractJob, "bytes" | "contentType">): boolean {
  if (PDF_TYPES.has(job.contentType)) return true;
  if (!UNKNOWN_TYPES.has(job.contentType)) return false;
  return new TextDecoder("latin1").decode(job.bytes.subarray(0, 5)) === "%PDF-";
}

/** Links and images in a document that was already Markdown, keeping each link's text. */
export function stripMarkdownLinks(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, "")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, "$1");
}

/** Bytes in, text out: everything that handles a page's content, in one place the worker runs. */
export function extractDocument(job: ExtractJob): ExtractedPage {
  const isHtml = HTML_TYPES.has(job.contentType);
  const decoded = decode(job, isHtml);

  if (isHtml) {
    const { title, text } = extractHtml(decoded, job.finalUrl, job.includeLinks ?? false);
    return { title, text: text.slice(0, MAX_TEXT_CHARS) };
  }

  const isMarkdown = job.contentType === "text/markdown";
  const text = cleanText(isMarkdown && !job.includeLinks ? stripMarkdownLinks(decoded) : decoded);
  const url = new URL(job.finalUrl);
  const fromText = isMarkdown ? markdownTitle(text) : undefined;
  const fromName = url.pathname.split("/").filter(Boolean).at(-1);
  return { title: fromText ?? fromName ?? url.host, text: text.slice(0, MAX_TEXT_CHARS) };
}
