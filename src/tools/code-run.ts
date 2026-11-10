import { z } from "zod";
import type { CodeRunner } from "../code/runner.js";
import { ToolFailure, type ToolOutput } from "./result.js";

export const CODE_RUN_MAX_CHARS = 20_000;
/** What a model gets of the output. The runner keeps 64 KB; past this, it's rarely worth the tokens. */
const OUTPUT_CHARS = 16_000;

export const CODE_RUN_DESCRIPTION =
  "Run Python 3.14 to calculate or check data exactly, rather than working it out in your head. numpy, pandas, scipy and " +
  "sympy are available. There's no network, no files and nothing to install. Only what the code prints, and the value " +
  "of its last line, comes back. Each call starts fresh, so put everything it needs in the code, data included.";

export const codeRunInput = z.object({
  code: z
    .string()
    .min(1)
    .max(CODE_RUN_MAX_CHARS)
    .describe("Python source. Print what you need, or end with an expression."),
});

export type CodeRunArgs = z.infer<typeof codeRunInput>;

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} seconds`;
}

function cut(text: string): { text: string; cut: boolean } {
  return text.length <= OUTPUT_CHARS
    ? { text, cut: false }
    : { text: text.slice(0, OUTPUT_CHARS), cut: true };
}

export async function codeRun(
  args: CodeRunArgs,
  runner: CodeRunner,
  timeoutMs: number,
): Promise<ToolOutput> {
  const r = await runner.run(args.code);
  const output = cut(r.output);
  const truncated = r.truncated || output.cut;
  // Never the code or the output: either may hold meeting content (as web_fetch logs only the host).
  const logFields = {
    outcome: r.status,
    code_chars: args.code.length,
    output_chars: r.output.length,
    ...(truncated ? { truncated: true } : {}),
    ...(r.run_ms != null ? { run_ms: r.run_ms } : {}),
    ...(r.waited_ms ? { waited_ms: r.waited_ms } : {}),
  };
  const printed = output.text.trimEnd();
  const cutNote = truncated
    ? `\n[Output cut at ${OUTPUT_CHARS.toLocaleString("en-US")} characters.]`
    : "";

  switch (r.status) {
    case "ok":
    case "python_error": {
      const parts: string[] = [];
      if (r.status === "python_error") {
        parts.push(`Python raised an error:\n${r.error ?? ""}`);
        if (printed) parts.push(`Printed before the error:\n${printed}${cutNote}`);
      } else {
        if (printed) parts.push(`Output:\n${printed}${cutNote}`);
        if (r.value != null) parts.push(`Value of the last line: ${r.value}`);
        if (!printed && r.value == null) {
          parts.push(
            "The code ran and printed nothing. Print what you need, or end with an expression.",
          );
        }
      }
      return {
        text: parts.join("\n\n"),
        meta: {
          status: r.status,
          output: output.text,
          truncated,
          value: r.value ?? null,
          error: r.error ?? null,
          run_ms: r.run_ms ?? null,
        },
        logFields,
      };
    }
    case "timeout":
      throw new ToolFailure(
        `The code ran for over ${seconds(timeoutMs)} and was stopped. Make it do less work, or look for a loop that never ends.`,
        "timeout",
        logFields,
      );
    case "out_of_memory":
      throw new ToolFailure(
        "The code ran out of memory and was stopped. Work on less data at once.",
        "error",
        logFields,
      );
    case "refused":
      throw new ToolFailure(
        "Python stopped: the code tried something this sandbox doesn't allow, such as running a program with os.system. " +
          "It has no network, no real files and no other programs.",
        "blocked",
        logFields,
      );
    case "busy":
      throw new ToolFailure(
        "Too many code runs are waiting right now. Try again shortly, or answer without running code.",
        "error",
        logFields,
      );
    case "crashed":
      throw new ToolFailure(
        "Python stopped unexpectedly. Try once more with simpler code.",
        "error",
        logFields,
      );
    default:
      throw new ToolFailure(
        "The code runner isn't answering right now. Answer without running code, and say so.",
        "error",
        logFields,
      );
  }
}
