// Runs each piece of code in a fresh runner.mjs process, used once and then gone, so nothing carries from one run to
// the next. A few are started ahead, so a run's wait is only its own work (about 50 ms, against 1.5 to 5 s cold).

/**
 * The child's only permission is reading Pyodide. --no-remote matters: plain Deno lets `import()` load code from esm.sh
 * and jsdelivr, and a URL carries data out (dev/code-run-spike). The wasm cap turns a Python memory bomb into a
 * MemoryError at about 950 MB instead of 4 GB; the JavaScript heap has its own cap; the pod's limit covers the rest.
 */
export function runnerArgs(dir) {
  return [
    "run",
    "--no-prompt",
    "--no-config",
    "--no-remote",
    "--no-npm",
    "--no-lock",
    "--v8-flags=--wasm-max-mem-pages=16384,--max-old-space-size=512",
    `--allow-read=${dir}/pyodide`,
    `${dir}/runner.mjs`,
  ];
}

export class Pool {
  #ready = [];
  #readyWaiters = [];
  #starting = 0;
  #running = 0;
  #slotWaiters = [];
  #closed = false;
  #children = new Set();

  /**
   * @param {object} o
   * @param {string} o.dir where runner.mjs and pyodide/ are
   * @param {number} o.size runners kept started ahead
   * @param {number} o.maxRunning runs at once; the rest wait their turn
   * @param {number} o.timeoutMs a run is killed after this
   * @param {number} o.queueTimeoutMs a run that waits longer than this for its turn is refused as busy
   * @param {number} [o.startTimeoutMs] a run that has its turn but no started runner by then is refused as unavailable
   * @param {(event: object) => void} [o.log]
   */
  constructor(o) {
    this.o = { log: () => {}, startTimeoutMs: 60_000, ...o };
    this.args = runnerArgs(o.dir);
  }

  start() {
    for (let i = this.#ready.length + this.#starting; i < this.o.size; i++) this.#spawn();
  }

  stats() {
    return {
      ready: this.#ready.length,
      starting: this.#starting,
      running: this.#running,
      waiting: this.#slotWaiters.length,
    };
  }

  async close() {
    this.#closed = true;
    for (const child of this.#children) {
      try {
        child.process.kill("SIGKILL");
      } catch {}
    }
    await Promise.allSettled([...this.#children].map((c) => c.process.status));
  }

  #spawn(attempt = 0) {
    if (this.#closed) return;
    this.#starting++;
    const process = new Deno.Command(Deno.execPath(), {
      args: this.args,
      // Nothing from this process's environment reaches the code. DENO_DIR only, for Deno's own cache.
      clearEnv: true,
      env: { DENO_DIR: Deno.env.get("DENO_DIR") ?? "/tmp/deno" },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const child = {
      process,
      lines: lineReader(process.stdout),
      stderr: collectText(process.stderr, 4096),
    };
    this.#children.add(child);
    process.status.then(() => {
      this.#children.delete(child);
      // A started-ahead runner can die while it waits: the kernel's out-of-memory killer may take it along with a
      // runaway run. Replace it, so no run is handed a dead one.
      const idle = this.#ready.indexOf(child);
      if (idle !== -1) {
        this.#ready.splice(idle, 1);
        this.#spawn();
      }
    });
    // A runaway run should be what the kernel kills when the pod runs out of memory, not this server.
    try {
      Deno.writeTextFileSync(`/proc/${process.pid}/oom_score_adj`, "1000");
    } catch {}

    child.lines.next().then(async ({ value }) => {
      this.#starting--;
      if (value === "READY") {
        const waiter = this.#readyWaiters.shift();
        if (waiter) waiter(child);
        else this.#ready.push(child);
        return;
      }
      const status = await process.status.catch(() => null);
      if (this.#closed) return;
      this.o.log({
        event: "code_runner.start_failed",
        exit: status?.code,
        stderr: (await child.stderr).slice(-500),
      });
      // Back off, so a broken image doesn't spin.
      setTimeout(() => this.#spawn(attempt + 1), Math.min(30_000, 500 * 2 ** attempt));
    });
  }

  /** A started-ahead runner, or null if none is ready in time, which means they're failing to start. */
  #takeReady() {
    const child = this.#ready.shift();
    if (child) return Promise.resolve(child);
    return new Promise((resolve) => {
      const waiter = (c) => {
        clearTimeout(timer);
        resolve(c);
      };
      const timer = setTimeout(() => {
        this.#readyWaiters.splice(this.#readyWaiters.indexOf(waiter), 1);
        resolve(null);
      }, this.o.startTimeoutMs);
      this.#readyWaiters.push(waiter);
    });
  }

  async #slot() {
    if (this.#running < this.o.maxRunning) {
      this.#running++;
      return true;
    }
    return await new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        this.#running++;
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#slotWaiters.splice(this.#slotWaiters.indexOf(waiter), 1);
        resolve(false);
      }, this.o.queueTimeoutMs);
      this.#slotWaiters.push(waiter);
    });
  }

  #release() {
    this.#running--;
    this.#slotWaiters.shift()?.();
  }

  /** @returns {Promise<{status: string, output: string, truncated: boolean, value?: string|null, error?: string, run_ms?: number}>} */
  async run(code) {
    const queuedAt = performance.now();
    if (!(await this.#slot())) return { status: "busy", output: "", truncated: false };
    try {
      const child = await this.#takeReady();
      if (!child) return { status: "unavailable", output: "", truncated: false };
      this.#spawn();
      const waited_ms = Math.round(performance.now() - queuedAt);
      return { ...(await this.#runIn(child, code)), waited_ms };
    } finally {
      this.#release();
    }
  }

  async #runIn(child, code) {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.process.kill("SIGKILL");
      } catch {}
    }, this.o.timeoutMs);
    const writer = child.process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify({ code }))).catch(() => {});
    await writer.close().catch(() => {});

    let output = "";
    let result = null;
    for await (const line of child.lines) {
      if (line.startsWith("OUT ")) output += `${JSON.parse(line.slice(4))}\n`;
      else if (line.startsWith("RESULT ")) result = JSON.parse(line.slice(7));
    }
    const status = await child.process.status;
    clearTimeout(timer);
    if (result && !timedOut) return { ...result, output };
    if (timedOut) return { status: "timeout", output, truncated: false };
    if (status.signal === "SIGKILL") return { status: "out_of_memory", output, truncated: false };
    // Python itself stopped: os.system, for one, takes the whole runtime down when Deno refuses it a program.
    const stderr = await child.stderr;
    const refused = /pyodide_fatal_error|NotCapable|Requires \w+ access/.test(stderr);
    this.o.log({
      event: "code_runner.crashed",
      exit: status.code,
      refused,
      stderr: stderr.slice(-500),
    });
    // Python's crash dump follows what the code printed; it's the runtime's frames, not the code's.
    const printed = output
      .split("Fatal Python error")[0]
      .split("Stack (most recent call first)")[0];
    return { status: refused ? "refused" : "crashed", output: printed, truncated: false };
  }
}

/** Lines from a byte stream, as an async iterator that can be read in parts. */
function lineReader(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const iterator = {
    async next() {
      for (;;) {
        const at = buffer.indexOf("\n");
        if (at !== -1) {
          const value = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          return { value, done: false };
        }
        const { value, done } = await reader.read();
        if (done) {
          if (buffer) {
            const rest = buffer;
            buffer = "";
            return { value: rest, done: false };
          }
          return { value: undefined, done: true };
        }
        buffer += value;
      }
    },
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
  return iterator;
}

/** The first `cap` characters of a stream, read to its end so the process never blocks on a full pipe. */
async function collectText(stream, cap) {
  let text = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    if (text.length < cap) text += chunk.slice(0, cap - text.length);
  }
  return text;
}
