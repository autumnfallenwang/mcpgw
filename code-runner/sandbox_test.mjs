// The sandbox, against real Deno and Pyodide. Needs code-runner/pyodide (node code-runner/fetch-pyodide.mjs).
//   deno test --allow-run --allow-read --allow-write=/proc --allow-env code-runner/
// CI has a network, so these show Deno's permissions hold on their own; the pod's NetworkPolicy is a second layer.
import assert from "node:assert/strict";
import { Pool } from "./pool.mjs";

const dir = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const pool = new Pool({ dir, size: 2, maxRunning: 2, timeoutMs: 15_000, queueTimeoutMs: 60_000 });
pool.start();
const opts = { sanitizeOps: false, sanitizeResources: false };

/** Each attempt prints ESCAPED or BLOCKED, so one run can try several ways out. */
const ATTEMPT = `
import inspect, js
from pyodide.ffi import to_js
def obj(d): return to_js(d, dict_converter=js.Object.fromEntries)
async def attempt(label, fn):
    try:
        r = fn()
        if inspect.isawaitable(r): r = await r
        print("ESCAPED", label, str(r)[:80])
    except BaseException as e:
        print("BLOCKED", label, type(e).__name__)
`;

async function attempts(body, expected) {
  const r = await pool.run(ATTEMPT + body);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const escaped = r.output.split("\n").filter((l) => l.startsWith("ESCAPED"));
  assert.deepEqual(escaped, []);
  assert.equal(
    r.output.split("\n").filter((l) => l.startsWith("BLOCKED")).length,
    expected,
    r.output,
  );
}

Deno.test("prints, and returns the last expression's repr", opts, async () => {
  const r = await pool.run("print('hello')\n{'a': 6 * 7}");
  assert.equal(r.status, "ok");
  assert.equal(r.output, "hello\n");
  assert.equal(r.value, "{'a': 42}");
});

Deno.test("numpy and pandas are ready, and scipy and sympy load when imported", opts, async () => {
  const r = await pool.run(`import pandas as pd, numpy as np
df = pd.DataFrame({"price": [199.0, 289.0], "tb": [8, 12]})
print((df.price / df.tb).round(2).tolist(), np.linalg.det(np.eye(2)))
import scipy.stats, sympy
print(round(scipy.stats.norm.cdf(1.96), 3), sympy.sqrt(8))`);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.output, "[24.88, 24.08] 1.0\n0.975 2*sqrt(2)\n");
});

Deno.test("a package that isn't shipped says what is", opts, async () => {
  const r = await pool.run("import requests");
  assert.equal(r.status, "python_error");
  assert.match(r.error, /ModuleNotFoundError: No module named 'requests'/);
  assert.match(r.error, /numpy, pandas, scipy and sympy/);
  assert.doesNotMatch(r.error, /micropip/);
});

Deno.test("a Python error is a short traceback of the code's own lines", opts, async () => {
  const r = await pool.run("x = 1\ny = x / 0");
  assert.equal(r.status, "python_error");
  assert.equal(
    r.error,
    'Traceback (most recent call last):\n  File "<code>", line 2, in <module>\nZeroDivisionError: division by zero',
  );
});

Deno.test("nothing reaches the network", opts, async () => {
  await attempts(
    `
await attempt("fetch", lambda: js.fetch("https://example.com").then(lambda r: r.status))
await attempt("fetch a cluster IP", lambda: js.fetch("http://10.43.0.1/").then(lambda r: r.status))
await attempt("fetch the home LAN", lambda: js.fetch("http://192.168.1.1/").then(lambda r: r.status))
import pyodide.http
await attempt("pyfetch", lambda: pyodide.http.pyfetch("https://example.com"))
await attempt("import() from esm.sh", lambda: js.eval("import('https://esm.sh/is-number@7.0.0?leak=1')"))
await attempt("import() from jsdelivr", lambda: js.eval("import('https://cdn.jsdelivr.net/npm/is-number@7.0.0/+esm')"))
await attempt("WebSocket", lambda: js.eval("new Promise((ok, no) => { const w = new WebSocket('wss://echo.websocket.org'); w.onopen = () => ok('open'); w.onerror = () => no(new Error('x')); })"))
await attempt("Deno.connect", lambda: js.Deno.connect(obj({"hostname": "example.com", "port": 80})))
await attempt("a unix socket", lambda: js.Deno.connect(obj({"transport": "unix", "path": "/var/run/docker.sock"})))
await attempt("DNS", lambda: js.Deno.resolveDns("example.com", "A"))
import urllib.request, socket
await attempt("urllib", lambda: urllib.request.urlopen("http://example.com", timeout=3))
await attempt("socket", lambda: socket.create_connection(("example.com", 80), timeout=3))
`,
    12,
  );
});

Deno.test("no real files, env, programs or FFI", opts, async () => {
  await attempts(
    `
await attempt("read /etc/passwd", lambda: js.Deno.readTextFile("/etc/passwd"))
await attempt("read the runner", lambda: js.Deno.readTextFile("${dir}/pool.mjs"))
await attempt("write /tmp", lambda: js.Deno.writeTextFile("/tmp/code-run-escape", "x"))
await attempt("env", lambda: js.Deno.env.toObject())
await attempt("run a program", lambda: js.Deno.Command.new("id").outputSync())
await attempt("FFI", lambda: js.Deno.dlopen("libc.so.6", obj({})))
import pyodide_js
def mount():
    pyodide_js.FS.mkdirTree("/host")
    pyodide_js.FS.mount(pyodide_js.FS.filesystems.NODEFS, obj({"root": "/"}), "/host")
    return open("/host/etc/passwd").read()
await attempt("mount the real disk", mount)
await attempt("Python's /etc/passwd", lambda: open("/etc/passwd").read())
`,
    8,
  );
});

Deno.test("os.system stops Python, and that's reported as refused", opts, async () => {
  const r = await pool.run("import os\nos.system('id')");
  assert.equal(r.status, "refused", JSON.stringify(r));
});

Deno.test("nothing carries over from one run to the next", opts, async () => {
  await pool.run("leftover = 1\nopen('/tmp/leftover', 'w').write('x')");
  const r = await pool.run(
    "import os\nprint('leftover' in globals(), os.path.exists('/tmp/leftover'))",
  );
  assert.equal(r.output, "False False\n");
});

Deno.test("a Python memory bomb is a MemoryError, near 1 GB", opts, async () => {
  const r = await pool.run(`x = []
try:
    while True:
        x.append(bytearray(50 * 1024 * 1024))
except MemoryError:
    print(len(x) * 50)`);
  assert.equal(r.status, "ok", JSON.stringify(r));
  const mb = Number(r.output.trim());
  assert.ok(mb > 500 && mb < 1100, `${mb} MB`);
});

Deno.test("output is cut at 64 KB", opts, async () => {
  const r = await pool.run("for i in range(100000):\n    print('x' * 100)");
  assert.equal(r.status, "ok");
  assert.equal(r.truncated, true);
  assert.ok(r.output.length <= 64 * 1024 + 200, String(r.output.length));
});

Deno.test("a started-ahead run answers in well under a second", opts, async () => {
  await pool.run("1");
  while (pool.stats().ready < 1) await new Promise((r) => setTimeout(r, 100));
  const t = performance.now();
  const r = await pool.run("sum(range(1000))");
  assert.equal(r.value, "499500");
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms`);
});

Deno.test(
  "limits: an endless loop is killed, and a run that waits too long is busy",
  opts,
  async () => {
    const small = new Pool({ dir, size: 1, maxRunning: 1, timeoutMs: 2_000, queueTimeoutMs: 500 });
    small.start();
    try {
      const loop = small.run("while True:\n    pass");
      const busy = await small.run("1");
      assert.equal(busy.status, "busy");
      const r = await loop;
      assert.equal(r.status, "timeout");
    } finally {
      await small.close();
    }
  },
);

Deno.test(
  "a refusal reads as a PermissionError, with no Deno flags or crash dumps",
  opts,
  async () => {
    const r = await pool.run("import js\nawait js.fetch('https://example.com')");
    assert.equal(r.status, "python_error");
    assert.match(
      r.error,
      /PermissionError: this sandbox has no net access \(asked for "example.com:443"\)/,
    );
    assert.doesNotMatch(r.error, /--allow/);
    const refused = await pool.run("print('before')\nimport os\nos.system('id')");
    assert.equal(refused.status, "refused");
    assert.equal(refused.output, "before\n");
  },
);

Deno.test("close", opts, async () => {
  await pool.close();
});
