import { QueueTimeout } from "./limiter.js";

/**
 * Spaces calls at least `gapMs` apart, in the order they arrive, across all callers. Waiting rather
 * than refusing is the point: one round of a meeting sends a burst of normal searches, and they should
 * all still run. A call that would wait longer than `maxWaitMs` fails, so a runaway caller can't build
 * an endless queue.
 */
export class Pacer {
  private nextAt = 0;

  constructor(
    private readonly gapMs: number,
    private readonly maxWaitMs: number,
  ) {}

  async wait(): Promise<void> {
    if (this.gapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    if (at - now > this.maxWaitMs) throw new QueueTimeout();
    this.nextAt = at + this.gapMs;
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}
