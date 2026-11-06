// Runs only in a worker, and is imported only when a PDF arrives, so serving HTML never loads pdf.js.
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { cleanText, type ExtractedPage, type ExtractJob, MAX_TEXT_CHARS } from "./extract.ts";

/**
 * Text only: nothing here loads the file's fonts or draws its pages, and this build of pdf.js has no
 * `new Function` path, the route CVE-2024-4367 used. A compressed stream can still inflate far past
 * the worker's heap cap, which is what the pool's memory watch is for.
 */
export async function extractPdf(job: ExtractJob): Promise<ExtractedPage> {
  const document = await getDocumentProxy(job.bytes, {
    disableFontFace: true,
    useSystemFonts: false,
    // Warnings would otherwise reach stdout, where everything is meant to be JSON for Loki.
    verbosity: 0,
  });
  const { info } = await getMeta(document).catch(() => ({ info: {} as Record<string, unknown> }));
  const { text } = await extractText(document, { mergePages: false });
  const url = new URL(job.finalUrl);
  const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.host);
  const title = cleanText(typeof info?.Title === "string" ? info.Title : "") || name;
  return { title, text: cleanText(text.join("\n\n")).slice(0, MAX_TEXT_CHARS) };
}
