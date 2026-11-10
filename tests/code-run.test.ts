import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CodeRunner, createCodeRunner, type RunnerResult } from "../src/code/runner.js";
import { codeRun } from "../src/tools/code-run.js";
import { ToolFailure } from "../src/tools/result.js";
import { type RunningServer, startApp } from "./helpers.js";

const SECRET = "the-meeting-notes-say-42";

function runner(result: Partial<RunnerResult>): CodeRunner & { codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    run: async (code) => {
      codes.push(code);
      return { status: "ok", output: "", truncated: false, ...result };
    },
    health: async () => "ok",
  };
}

async function failure(result: Partial<RunnerResult>): Promise<ToolFailure> {
  try {
    await codeRun({ code: `print("${SECRET}")` }, runner(result), 20_000);
  } catch (err) {
    if (err instanceof ToolFailure) return err;
    throw err;
  }
  throw new Error("expected a ToolFailure");
}

describe("code_run", () => {
  it("returns what the code printed and the last line's value", async () => {
    const out = await codeRun(
      { code: "print(1)\n6 * 7" },
      runner({ output: "1\n", value: "42", run_ms: 3 }),
      20_000,
    );
    expect(out.text).toBe("Output:\n1\n\nValue of the last line: 42");
    expect(out.meta).toMatchObject({ status: "ok", output: "1\n", value: "42" });
  });

  it("says so when nothing was printed", async () => {
    const out = await codeRun({ code: "x = 1" }, runner({}), 20_000);
    expect(out.text).toMatch(/printed nothing/);
  });

  it("shows a Python error, and what was printed before it, as a normal result", async () => {
    const out = await codeRun(
      { code: "print('a')\n1/0" },
      runner({
        status: "python_error",
        output: "a\n",
        error:
          'Traceback (most recent call last):\n  File "<code>", line 2\nZeroDivisionError: division by zero',
      }),
      20_000,
    );
    expect(out.text).toMatch(/^Python raised an error:\nTraceback/);
    expect(out.text).toMatch(/ZeroDivisionError/);
    expect(out.text).toMatch(/Printed before the error:\na$/);
    expect(out.logFields?.outcome).toBe("python_error");
  });

  it("cuts long output, and says where", async () => {
    const out = await codeRun({ code: "..." }, runner({ output: "x".repeat(20_000) }), 20_000);
    expect(out.text.length).toBeLessThan(16_200);
    expect(out.text).toMatch(/\[Output cut at 16,000 characters\.\]$/);
    expect(out.logFields?.truncated).toBe(true);
  });

  it.each([
    ["timeout", "timeout", /over 20 seconds/],
    ["out_of_memory", "error", /out of memory/],
    ["refused", "blocked", /doesn't allow/],
    ["busy", "error", /Too many code runs/],
    ["crashed", "error", /stopped unexpectedly/],
    ["unavailable", "error", /isn't answering/],
  ] as const)(
    "turns %s into a failure the model can act on",
    async (status, failStatus, message) => {
      const err = await failure({ status });
      expect(err.status).toBe(failStatus);
      expect(err.message).toMatch(message);
      expect(err.logFields.outcome).toBe(status);
    },
  );

  it("never logs the code or what it printed", async () => {
    const out = await codeRun(
      { code: `print("${SECRET}")` },
      runner({ output: `${SECRET}\n` }),
      20_000,
    );
    expect(JSON.stringify(out.logFields)).not.toContain(SECRET);
    expect(out.logFields).toMatchObject({ code_chars: 33, output_chars: 25 });
    expect(
      JSON.stringify((await failure({ status: "timeout", output: SECRET })).logFields),
    ).not.toContain(SECRET);
  });
});

describe("the runner client, against a fake runner", () => {
  let server: Server;
  let base: string;
  let reply: { status: number; body: string };
  let lastBody = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        lastBody = body;
        res.writeHead(req.url === "/ready" ? reply.status : reply.status, {
          "content-type": "application/json",
        });
        res.end(reply.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("posts the code and reads the result", async () => {
    reply = {
      status: 200,
      body: JSON.stringify({ status: "ok", output: "2\n", truncated: false }),
    };
    const r = await createCodeRunner(base, 2_000).run("print(1 + 1)");
    expect(JSON.parse(lastBody)).toEqual({ code: "print(1 + 1)" });
    expect(r).toMatchObject({ status: "ok", output: "2\n" });
  });

  it("calls a bad answer, an error status or no answer unavailable", async () => {
    reply = { status: 200, body: "not json" };
    expect((await createCodeRunner(base, 2_000).run("1")).status).toBe("unavailable");
    reply = { status: 500, body: "{}" };
    expect((await createCodeRunner(base, 2_000).run("1")).status).toBe("unavailable");
    expect((await createCodeRunner("http://127.0.0.1:1", 2_000).run("1")).status).toBe(
      "unavailable",
    );
  });

  it("is healthy only when a runner is ready", async () => {
    reply = { status: 200, body: "{}" };
    expect(await createCodeRunner(base, 2_000).health()).toBe("ok");
    reply = { status: 503, body: "{}" };
    expect(await createCodeRunner(base, 2_000).health()).toBe("down");
  });
});

describe("code_run over MCP", () => {
  let withCode: RunningServer;
  let without: RunningServer;
  const fake = runner({ output: "ran\n" });
  beforeAll(async () => {
    withCode = await startApp({ code: { runner: fake, timeoutMs: 20_000 } });
    without = await startApp();
  });
  afterAll(async () => {
    await withCode.close();
    await without.close();
  });

  async function client(app: RunningServer) {
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${app.url}/mcp`)));
    return c;
  }

  it("is offered only when a runner is configured, and says it reaches nothing", async () => {
    const c = await client(withCode);
    const tool = (await c.listTools()).tools.find((t) => t.name === "code_run");
    expect(tool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tool?.inputSchema.required).toEqual(["code"]);
    await c.close();
    const d = await client(without);
    expect((await d.listTools()).tools.map((t) => t.name)).not.toContain("code_run");
    await d.close();
  });

  it("runs code and returns text", async () => {
    const c = await client(withCode);
    const result = await c.callTool({ name: "code_run", arguments: { code: "print('ran')" } });
    expect(result.isError).toBeFalsy();
    expect((result.content as { text: string }[])[0]?.text).toBe("Output:\nran");
    expect(fake.codes).toContain("print('ran')");
    await c.close();
  });

  it("shows the runner on /health and /docs", async () => {
    const health = (await (await fetch(`${withCode.url}/health`)).json()) as Record<string, string>;
    expect(Object.keys(health)).toContain("code_runner");
    const page = await (await fetch(`${withCode.url}/docs`)).text();
    expect(page).toContain("code_run");
    expect(page).toContain("Code runner");
    const plain = await (await fetch(`${without.url}/docs`)).text();
    expect(plain).not.toContain("Code runner");
  });
});
