// Runs every case under every host, each run its own process with a hard kill after TIMEOUT_MS, and writes
// results/cases.json. The open Node host is the control: escapes there should succeed, which shows the cases can tell.
//   node run-cases.mjs [case-name ...]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 10_000;

const HOSTS = {
  deno: ["deno", "run", "--no-prompt", "--no-config", `--allow-read=${HERE}`, "runner.mjs"],
  "deno-no-remote": ["deno", "run", "--no-prompt", "--no-config", "--no-remote", "--no-npm", `--allow-read=${HERE}`, "runner.mjs"],
  node: ["node", "--permission", `--allow-fs-read=${HERE}`, "runner.mjs"],
  "node-open (control)": ["node", "runner.mjs"],
  // WebAssembly memory capped at 1 GiB (16,384 pages of 64 KiB), instead of Pyodide's 4 GiB.
  "deno-no-remote-1GiB": ["deno", "run", "--no-prompt", "--no-config", "--no-remote", "--no-npm", "--v8-flags=--wasm-max-mem-pages=16384", `--allow-read=${HERE}`, "runner.mjs"],
  "node-1GiB": ["node", "--permission", "--wasm-max-mem-pages=16384", `--allow-fs-read=${HERE}`, "runner.mjs"],
};
// HOSTS=name,name limits the run to those hosts.
const pick = process.env.HOSTS?.split(",");
for (const name of Object.keys(HOSTS)) if (pick && !pick.includes(name)) delete HOSTS[name];

// Each escape attempt prints ESCAPED or BLOCKED, so one case can try several things.
const PRELUDE = `
import inspect, js
from pyodide.ffi import to_js
def obj(d): return to_js(d, dict_converter=js.Object.fromEntries)
async def attempt(label, fn):
    try:
        r = fn()
        if inspect.isawaitable(r): r = await r
        print("ESCAPED", label, "->", str(r)[:100].replace("\\n", " "))
    except BaseException as e:
        print("BLOCKED", label, "->", type(e).__name__, str(e)[:140].replace("\\n", " "))
`;

const CASES = {
  basic: `import sys\nprint(sum(i*i for i in range(1000)), sys.version.split()[0])`,
  "numpy pandas": `import numpy as np, pandas as pd
df = pd.DataFrame({"drive": ["a", "b", "c"], "price": [199.0, 289.0, 449.0], "tb": [8, 12, 20]})
df["per_tb"] = (df.price / df.tb).round(2)
print(df.sort_values("per_tb").to_string(index=False))
print(np.linalg.inv(np.array([[2.0, 1.0], [1.0, 3.0]])).round(3).tolist())`,
  "scipy sympy": `import scipy.stats as st, sympy as sp
x = sp.symbols("x")
print(round(st.norm.cdf(1.96), 4), sp.solve(x**2 - 2, x))`,
  compute: `import time, numpy as np
t = time.perf_counter(); s = sum(range(10**7)); a = time.perf_counter() - t
m = np.random.rand(1000, 1000); t = time.perf_counter(); m @ m; b = time.perf_counter() - t
print(f"python 1e7 sum {a:.2f}s, numpy 1000x1000 matmul {b:.2f}s")`,

  "network from JS": `${PRELUDE}
await attempt("fetch internet https://example.com", lambda: js.fetch("https://example.com").then(lambda r: r.status))
await attempt("fetch cluster service mcpgw", lambda: js.fetch("http://mcpgw.mcpgw.svc.cluster.local/health").then(lambda r: r.status))
await attempt("fetch cluster IP (Loki)", lambda: js.fetch("http://10.43.184.221:3100/ready").then(lambda r: r.status))
await attempt("fetch home LAN 192.168.1.163", lambda: js.fetch("http://192.168.1.163/").then(lambda r: r.status))
import pyodide.http
await attempt("pyodide.http.pyfetch", lambda: pyodide.http.pyfetch("https://example.com"))
await attempt("dynamic import https://esm.sh", lambda: js.eval("import('https://esm.sh/is-number@7.0.0?leak=secret')").then(lambda m: "loaded"))
await attempt("dynamic import https://cdn.jsdelivr.net", lambda: js.eval("import('https://cdn.jsdelivr.net/npm/is-number@7.0.0/+esm')").then(lambda m: "loaded"))
await attempt("WebSocket", lambda: js.eval("new Promise((res, rej) => { const w = new WebSocket('wss://echo.websocket.org'); w.onopen = () => { w.close(); res('open'); }; w.onerror = () => rej(new Error('error event')); })"))`,

  "network from Python": `${PRELUDE}
import urllib.request, socket
await attempt("urllib", lambda: urllib.request.urlopen("http://example.com", timeout=5).status)
await attempt("socket", lambda: socket.create_connection(("example.com", 80), timeout=5))
import pyodide.http
await attempt("open_url (sync XHR)", lambda: pyodide.http.open_url("https://example.com").read()[:20])`,

  "host access, Deno": `${PRELUDE}
if not hasattr(js, "Deno"):
    print("SKIP not Deno")
else:
    D = js.Deno
    await attempt("Deno.connect tcp", lambda: D.connect(obj({"hostname": "example.com", "port": 80})).then(lambda c: c.close()))
    await attempt("Deno.connect unix docker.sock", lambda: D.connect(obj({"transport": "unix", "path": "/var/run/docker.sock"})).then(lambda c: c.close()))
    await attempt("Deno.resolveDns", lambda: D.resolveDns("example.com", "A"))
    await attempt("read /etc/passwd", lambda: D.readTextFile("/etc/passwd"))
    await attempt("read the repo's package.json", lambda: D.readTextFile("${join(HERE, "../../package.json")}"))
    await attempt("write /tmp", lambda: D.writeTextFile("/tmp/code-run-spike-escape", "x"))
    await attempt("env", lambda: D.env.toObject())
    await attempt("run a command", lambda: D.Command.new("id").outputSync().code)
    await attempt("FFI dlopen", lambda: D.dlopen("libc.so.6", obj({})))
    await attempt("new Worker", lambda: js.eval("new Worker('data:text/javascript,postMessage(1)', {type: 'module'})"))`,

  "host access, Node": `${PRELUDE}
if not hasattr(js, "process") or hasattr(js, "Deno"):
    print("SKIP not Node")
else:
    gb = js.process.getBuiltinModule
    await attempt("net.connect tcp", lambda: js.eval("new Promise((res, rej) => { const s = process.getBuiltinModule('net').connect(80, 'example.com'); s.on('connect', () => { s.destroy(); res('connected'); }); s.on('error', rej); })"))
    await attempt("net.connect unix docker.sock", lambda: js.eval("new Promise((res, rej) => { const s = process.getBuiltinModule('net').connect('/var/run/docker.sock'); s.on('connect', () => { s.destroy(); res('connected'); }); s.on('error', rej); })"))
    await attempt("dns.lookup", lambda: gb("dns").promises.lookup("example.com").then(lambda a: a.address))
    await attempt("http.get", lambda: js.eval("new Promise((res, rej) => process.getBuiltinModule('http').get('http://example.com', r => { r.resume(); res(r.statusCode); }).on('error', rej))"))
    await attempt("read /etc/passwd", lambda: gb("fs").readFileSync("/etc/passwd", "utf8"))
    await attempt("read the repo's package.json", lambda: gb("fs").readFileSync("${join(HERE, "../../package.json")}", "utf8"))
    await attempt("write /tmp", lambda: gb("fs").writeFileSync("/tmp/code-run-spike-escape", "x"))
    await attempt("env", lambda: js.process.env.HOME)
    await attempt("run a command", lambda: gb("child_process").execSync("id").toString())
    await attempt("new Worker", lambda: js.eval("new (process.getBuiltinModule('worker_threads').Worker)('1', {eval: true})"))`,

  "Python: mount the host disk": `${PRELUDE}
import pyodide_js
def mount_host():
    FS = pyodide_js.FS
    FS.mkdirTree("/host")
    FS.mount(FS.filesystems.NODEFS, obj({"root": "/"}), "/host")
    return open("/host/etc/passwd").read()[:60]
await attempt("mount the host disk (NODEFS) and read /etc/passwd", mount_host)`,
  "Python: its own files": `${PRELUDE}
import os
await attempt("open /etc/passwd", lambda: open("/etc/passwd").read()[:60])
await attempt("listdir /", lambda: os.listdir("/"))
await attempt("listdir /home", lambda: os.listdir("/home"))`,
  "Python: os.system": `${PRELUDE}
import os
await attempt("os.system", lambda: os.system("id > /tmp/code-run-spike-system"))`,
  "Python: subprocess": `${PRELUDE}
import subprocess
await attempt("subprocess", lambda: subprocess.run(["id"], capture_output=True).stdout)`,
  "endless loop": `while True:\n    pass`,
  "memory bomb": `x = []
try:
    while True:
        x.append(bytearray(50 * 1024 * 1024))
except MemoryError:
    print("MemoryError after", len(x) * 50, "MB")`,
  "output flood": `for i in range(200000):\n    print("x" * 100)`,
  "deep recursion": `def f(n): return f(n + 1)\ntry:\n    f(0)\nexcept RecursionError as e:\n    print("RecursionError", e)`,
};

function runOnce(argv, code) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(argv[0], argv.slice(1), { cwd: HERE, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let peakKb = 0;
    const sample = setInterval(() => {
      try {
        const m = /VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, "utf8"));
        if (m) peakKb = Math.max(peakKb, Number(m[1]));
      } catch {}
    }, 50);
    const killer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (exitCode, signal) => {
      clearInterval(sample);
      clearTimeout(killer);
      const wall_ms = Math.round(performance.now() - started);
      const last = stdout.trim().split("\n").pop() ?? "";
      let parsed = null;
      try {
        parsed = JSON.parse(last);
      } catch {}
      resolve({
        wall_ms,
        peak_rss_mb: Math.round(peakKb / 1024),
        ...(signal ? { killed: signal } : {}),
        ...(exitCode ? { exit: exitCode } : {}),
        ...(parsed ?? { raw: last.slice(0, 300), stderr: stderr.slice(-400) }),
      });
    });
    child.stdin.end(JSON.stringify({ code }));
  });
}

const only = process.argv.slice(2);
const results = {};
for (const [name, code] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  results[name] = {};
  for (const [host, argv] of Object.entries(HOSTS)) {
    const r = await runOnce(argv, code);
    results[name][host] = r;
    const lines = (r.output ?? "").split("\n").filter((l) => /^(ESCAPED|BLOCKED|SKIP)/.test(l));
    const summary = r.killed
      ? `killed after ${r.wall_ms} ms`
      : lines.length
        ? `${lines.filter((l) => l.startsWith("ESCAPED")).length} escaped, ${lines.filter((l) => l.startsWith("BLOCKED")).length} blocked`
        : r.ok
          ? `ok: ${(r.output ?? "").trim().split("\n").slice(-1)[0]?.slice(0, 90)}`
          : `error: ${(r.error ?? r.raw ?? r.stderr ?? "").slice(0, 120)}`;
    console.log(`${name.padEnd(30)} ${host.padEnd(20)} ${String(r.wall_ms).padStart(6)} ms ${String(r.peak_rss_mb).padStart(5)} MB  ${summary}`);
  }
}
mkdirSync(join(HERE, "results"), { recursive: true });
const file = join(HERE, "results", only.length ? `cases-${only.join("-").replace(/\W+/g, "_")}.json` : "cases.json");
writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2)}\n`);
console.log(`\nwrote ${file}`);
