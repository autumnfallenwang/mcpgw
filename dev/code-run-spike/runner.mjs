// One code run: read {code} as JSON on stdin, run it in Pyodide, print one JSON line. Runs under Deno or Node, each with
// its own permission flags (see run-cases.mjs). Pyodide and its packages load from ./dist/pyodide only.
import { loadPyodide } from "./dist/pyodide/pyodide.mjs";

const OUTPUT_CAP = 64 * 1024;
const t0 = performance.now();
const indexURL = new URL("./dist/pyodide/", import.meta.url).pathname;

// Emscripten's file layer reads process.binding("constants").fs at start-up, and Node's permission model refuses
// process.binding. fs.constants holds the same values, so that one call is answered here, before any code runs.
if (!globalThis.Deno && process.permission?.has) {
  const { constants } = await import("node:fs");
  const binding = process.binding.bind(process);
  process.binding = (name) => (name === "constants" ? { fs: constants } : binding(name));
}

async function readStdin() {
  if (globalThis.Deno) return await new Response(Deno.stdin.readable).text();
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

let out = "";
let truncated = false;
const collect = (s) => {
  if (out.length >= OUTPUT_CAP) {
    truncated = true;
    return;
  }
  out += `${s}\n`;
};

// --warm: load Pyodide and import numpy and pandas first, say READY, and only then wait for the code. A pool of these
// would be started ahead of each run, so a run's wait is only its own work.
const warm = (globalThis.Deno ? Deno.args : process.argv.slice(2)).includes("--warm");
let pyodide;
const timings = {};
if (warm) {
  pyodide = await loadPyodide({ indexURL, stdout: collect, stderr: collect });
  await pyodide.loadPackage(["numpy", "pandas"], { messageCallback: () => {} });
  await pyodide.runPythonAsync("import numpy, pandas");
  timings.warmup_ms = Math.round(performance.now() - t0);
  console.log("READY");
}
const { code } = JSON.parse(await readStdin());
const tCode = performance.now();
let result;
try {
  pyodide ??= await loadPyodide({
    indexURL,
    stdout: collect,
    stderr: collect,
  });
  timings.load_ms = Math.round(performance.now() - tCode);
  const t1 = performance.now();
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: collect });
  timings.packages_ms = Math.round(performance.now() - t1);
  const t2 = performance.now();
  const value = await pyodide.runPythonAsync(code);
  timings.run_ms = Math.round(performance.now() - t2);
  result = { ok: true, value: value === undefined ? null : String(value) };
} catch (err) {
  result = { ok: false, error: String(err?.message ?? err).split("\n").slice(-3).join(" | ") };
}
const rss = globalThis.Deno ? Deno.memoryUsage().rss : process.memoryUsage().rss;
console.log(
  JSON.stringify({ ...result, output: out.slice(0, OUTPUT_CAP), truncated, timings, rss_mb: Math.round(rss / 2 ** 20) }),
);
