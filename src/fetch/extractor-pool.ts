import { Worker } from "node:worker_threads";
import type { ExtractedPage, ExtractJob } from "./extract.js";

/** A page that couldn't be read within the limits. Only that one request fails. */
export class ExtractFailure extends Error {
  constructor(readonly kind: "timeout" | "memory" | "crash") {
    super(`extraction failed: ${kind}`);
    this.name = "ExtractFailure";
  }
}

export interface ExtractorPoolOptions {
  size?: number;
  timeoutMs?: number;
  maxOldMb?: number;
  /** The whole process's memory, which is what the pod's limit counts. */
  maxRssMb?: number;
}

interface Waiting {
  job: ExtractJob;
  resolve: (page: ExtractedPage) => void;
  reject: (err: Error) => void;
}

const WORKER_URL = new URL("./extract-worker.ts", import.meta.url);
const RSS_CHECK_MS = 10;
const RSS_GROWTH_BYTES = 64 * 1024 * 1024;

/**
 * Parsing a hostile page is the one thing here that a model can make expensive: 5 MB of tags took
 * 9.5 s and 1.3 GB on the main thread, which froze every caller and would get the pod killed. So
 * pages are parsed in workers with a memory cap and a time limit, and a page over either costs only
 * its own request. A worker that went over is thrown away, since it can't be trusted to recover.
 *
 * The worker's heap cap doesn't see buffers: a 0.2 MB PDF whose stream inflates to 256 MB peaked at
 * 626 MB without touching it, past the pod's 512 MB limit. So the process's own memory is watched too.
 */
export class ExtractorPool {
  private readonly size: number;
  private readonly timeoutMs: number;
  private readonly maxOldMb: number;
  private readonly maxRssBytes: number;
  private readonly idle: Worker[] = [];
  private readonly queue: Waiting[] = [];
  private busy = 0;
  private nextId = 0;
  private closed = false;

  constructor(options: ExtractorPoolOptions = {}) {
    this.size = options.size ?? 2;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxOldMb = options.maxOldMb ?? 192;
    this.maxRssBytes = (options.maxRssMb ?? 350) * 1024 * 1024;
  }

  run(job: ExtractJob): Promise<ExtractedPage> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  private spawn(): Worker {
    const worker = new Worker(WORKER_URL, {
      // Not the parent's `--import tsx`: Node strips the types itself, far faster to start.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: this.maxOldMb, maxYoungGenerationSizeMb: 32 },
    });
    worker.unref();
    return worker;
  }

  private pump(): void {
    while (!this.closed && this.queue.length > 0 && this.busy < this.size) {
      const next = this.queue.shift()!;
      this.busy++;
      this.start(this.idle.pop() ?? this.spawn(), next);
    }
  }

  private start(worker: Worker, { job, resolve, reject }: Waiting): void {
    const id = this.nextId++;
    let settled = false;

    const finish = (keep: boolean) => {
      settled = true;
      clearTimeout(timer);
      clearInterval(memoryWatch);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      this.busy--;
      if (keep && !this.closed) this.idle.push(worker);
      else void worker.terminate();
      this.pump();
    };

    const onMessage = (msg: { id: number; page?: ExtractedPage; error?: string }) => {
      if (msg.id !== id || settled) return;
      finish(true);
      if (msg.page) resolve(msg.page);
      else reject(new ExtractFailure("crash"));
    };
    const onError = (err: Error & { code?: string }) => {
      if (settled) return;
      finish(false);
      reject(new ExtractFailure(err.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crash"));
    };
    const onExit = () => {
      if (settled) return;
      finish(false);
      reject(new ExtractFailure("crash"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish(false);
      reject(new ExtractFailure("timeout"));
    }, this.timeoutMs);
    // Only a job that's growing can trip this. Memory is slow to come back after a bad page, and the
    // next page shouldn't pay for that.
    const rssAtStart = process.memoryUsage.rss();
    const memoryWatch = setInterval(() => {
      if (settled) return;
      const rss = process.memoryUsage.rss();
      if (rss <= this.maxRssBytes || rss - rssAtStart <= RSS_GROWTH_BYTES) return;
      finish(false);
      reject(new ExtractFailure("memory"));
    }, RSS_CHECK_MS);
    memoryWatch.unref();

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage({ id, job }, [job.bytes.buffer as ArrayBuffer]);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.idle.splice(0).map((w) => w.terminate()));
  }
}
