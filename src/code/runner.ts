import { z } from "zod";

/** What the code runner (code-runner/server.mjs) answers. */
export const runnerResult = z.object({
  status: z.enum([
    "ok",
    "python_error",
    "timeout",
    "out_of_memory",
    "refused",
    "crashed",
    "busy",
    "unavailable",
  ]),
  output: z.string(),
  truncated: z.boolean(),
  value: z.string().nullish(),
  error: z.string().nullish(),
  run_ms: z.number().nullish(),
  waited_ms: z.number().nullish(),
});
export type RunnerResult = z.infer<typeof runnerResult>;

export interface CodeRunner {
  run(code: string): Promise<RunnerResult>;
  health(): Promise<"ok" | "down">;
}

/** The runner in its own pod: mcpgw only sends it code over HTTP, and holds no Kubernetes rights (ADR 0014). */
export function createCodeRunner(baseUrl: string, timeoutMs: number): CodeRunner {
  return {
    async run(code) {
      let res: Response;
      try {
        res = await fetch(new URL("/run", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { status: "unavailable", output: "", truncated: false };
      }
      if (!res.ok) return { status: "unavailable", output: "", truncated: false };
      const parsed = runnerResult.safeParse(await res.json().catch(() => null));
      return parsed.success ? parsed.data : { status: "unavailable", output: "", truncated: false };
    },
    async health() {
      try {
        const res = await fetch(new URL("/ready", baseUrl), { signal: AbortSignal.timeout(2_000) });
        return res.ok ? "ok" : "down";
      } catch {
        return "down";
      }
    },
  };
}
