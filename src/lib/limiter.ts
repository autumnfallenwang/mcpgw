export class QueueTimeout extends Error {
  constructor() {
    super("Waited too long for a free slot");
    this.name = "QueueTimeout";
  }
}

/** At most `max` calls at once. A call that waits longer than `queueWaitMs` for a slot fails. */
export class Limiter {
  private active = 0;
  private readonly waiting = new Set<() => void>();

  constructor(
    private readonly max: number,
    private readonly queueWaitMs: number,
  ) {}

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        this.waiting.delete(grant);
        this.active++;
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiting.delete(grant);
        reject(new QueueTimeout());
      }, this.queueWaitMs);
      this.waiting.add(grant);
    });
  }

  private release(): void {
    this.active--;
    const [next] = this.waiting;
    next?.();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
