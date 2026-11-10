// One code run, in its own Deno process with no permissions but reading ./pyodide (pool.mjs starts it). It loads Python
// and the common packages first and prints READY, so the wait is over before the code arrives. Then it reads {code} as
// JSON on stdin, streams what the code prints as OUT lines, and ends with one RESULT line. It's never used twice.
import { loadPyodide } from "./pyodide/pyodide.mjs";

const OUTPUT_CAP = 64 * 1024;
const TRACEBACK_CAP = 8 * 1024;
const VALUE_CAP = 4 * 1024;
/** Import names of the packages fetch-pyodide.mjs ships, and the package each comes from. */
const SHIPPED = {
  numpy: "numpy",
  pandas: "pandas",
  scipy: "scipy",
  sympy: "sympy",
  mpmath: "mpmath",
  dateutil: "python-dateutil",
  pytz: "pytz",
  six: "six",
};

const MISSING_PACKAGE_HINT =
  "Only Python's standard library and numpy, pandas, scipy and sympy are available. Nothing can be installed.";

const encoder = new TextEncoder();
const send = (line) => Deno.stdout.writeSync(encoder.encode(`${line}\n`));

let written = 0;
let truncated = false;
const print = (text) => {
  if (written >= OUTPUT_CAP) {
    truncated = true;
    return;
  }
  const part = text.slice(0, OUTPUT_CAP - written);
  if (part.length < text.length) truncated = true;
  written += part.length + 1;
  send(`OUT ${JSON.stringify(part)}`);
};

const pyodide = await loadPyodide({
  indexURL: new URL("./pyodide/", import.meta.url).pathname,
  stdout: print,
  stderr: print,
});
await pyodide.loadPackage(["numpy", "pandas"], { messageCallback: () => {} });
await pyodide.runPythonAsync("import numpy, pandas");
send("READY");

const { code } = JSON.parse(await new Response(Deno.stdin.readable).text());
const started = performance.now();

// Only shipped packages load. Anything else is left to fail as a ModuleNotFoundError, rather than Pyodide trying its CDN.
const imports = pyodide.pyimport("pyodide.code").find_imports(code).toJs();
const needed = [...new Set(imports.map((name) => SHIPPED[name]).filter(Boolean))];
if (needed.length) await pyodide.loadPackage(needed, { messageCallback: () => {} });

/** Pyodide's own frames say nothing to the model: keep the code's frames and the error itself. */
function traceback(message) {
  // Deno's refusal says to run again with a flag, which isn't the model's to give.
  const plain = message.replace(
    /NotCapable: Requires (\w+) access to ("[^"]*"), run again with the --allow-\w+ flag/g,
    "PermissionError: this sandbox has no $1 access (asked for $2)",
  );
  let lines = plain.trimEnd().split("\n");
  // Pyodide's hint for a missing package says to install it, which can't work here: there's no network.
  const hint = lines.findIndex((l) => l.includes("is included in the Pyodide distribution"));
  if (hint !== -1) lines = [...lines.slice(0, hint), MISSING_PACKAGE_HINT];
  const first = lines.findIndex((l) => l.includes('File "<code>"'));
  const kept =
    first === -1 ? lines.slice(-1) : ["Traceback (most recent call last):", ...lines.slice(first)];
  return kept.join("\n").slice(0, TRACEBACK_CAP);
}

pyodide.globals.set("__code_run_source", code);
let result;
try {
  const value = await pyodide.runPythonAsync(`
from pyodide.code import eval_code_async as __code_run_eval
__code_run_value = await __code_run_eval(__code_run_source, {"__name__": "__main__"}, filename="<code>")
None if __code_run_value is None else repr(__code_run_value)
`);
  result = { status: "ok", value: value == null ? null : String(value).slice(0, VALUE_CAP) };
} catch (err) {
  if (err?.type) {
    result = { status: "python_error", error: traceback(String(err.message)) };
  } else {
    throw err;
  }
}
send(
  `RESULT ${JSON.stringify({ ...result, truncated, run_ms: Math.round(performance.now() - started) })}`,
);
