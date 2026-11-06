// Runs in a worker thread, with no tsx: Node strips the types itself, hence the .ts import.
import { parentPort } from "node:worker_threads";
import { type ExtractJob, extractDocument } from "./extract.ts";

parentPort?.on("message", ({ id, job }: { id: number; job: ExtractJob }) => {
  try {
    parentPort?.postMessage({ id, page: extractDocument(job) });
  } catch (err) {
    parentPort?.postMessage({ id, error: String(err) });
  }
});
