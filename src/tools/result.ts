import type { CallToolResult } from "@modelcontextprotocol/server";
import { log, logContext } from "../lib/logger.js";

/** Where app data goes on a tool result. Models don't see it (ADR 0004). */
export const META_KEY = "arch.internal/mcpgw";

export interface ToolOutput {
  /** Everything a model needs. It's the only part every client shows. */
  text: string;
  /** The same data as JSON, for apps. */
  meta: Record<string, unknown>;
  /** Extra fields for the `tool.call` log line. */
  logFields?: Record<string, unknown>;
}

export type FailureStatus = "error" | "blocked" | "timeout";

/** The tool ran and couldn't finish. The message goes to the model, so it says what to do next. */
export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly status: FailureStatus,
    readonly logFields: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

/** Runs a tool, writes its one `tool.call` line, and turns failures into `isError` results. */
export async function runTool(
  tool: string,
  fn: () => Promise<ToolOutput>,
  baseLogFields: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const start = Date.now();
  const ctx = logContext();
  const line = {
    event: "tool.call",
    tool,
    ...(ctx?.client ? { client: ctx.client } : {}),
    ...(ctx?.request_id ? { request_id: ctx.request_id } : {}),
    ...baseLogFields,
  };
  try {
    const output = await fn();
    log.info(
      { ...line, status: "ok", duration_ms: Date.now() - start, ...output.logFields },
      "tool called",
    );
    return {
      content: [{ type: "text", text: output.text }],
      _meta: { [META_KEY]: output.meta },
    };
  } catch (err) {
    if (err instanceof ToolFailure) {
      log.warn(
        { ...line, status: err.status, duration_ms: Date.now() - start, ...err.logFields },
        "tool called",
      );
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    log.error({ ...line, status: "error", duration_ms: Date.now() - start, err }, "tool called");
    return {
      content: [
        {
          type: "text",
          text: "mcpgw hit an unexpected error running this tool. Try once more, or answer without it.",
        },
      ],
      isError: true,
    };
  }
}
