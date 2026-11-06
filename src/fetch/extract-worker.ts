// Runs in a worker thread, with no tsx: Node strips the types itself, hence the .ts imports.
import { parentPort } from "node:worker_threads";
import { type ExtractJob, extractDocument, isPdf } from "./extract.ts";

async function extract(job: ExtractJob) {
  if (!isPdf(job)) return extractDocument(job);
  const { extractPdf } = await import("./extract-pdf.ts");
  return extractPdf(job);
}

parentPort?.on("message", ({ id, job }: { id: number; job: ExtractJob }) => {
  extract(job).then(
    (page) => parentPort?.postMessage({ id, page }),
    (err) => parentPort?.postMessage({ id, error: String(err) }),
  );
});
