# code_run spike: Pyodide under Deno or Node

Can Python compiled to WebAssembly (Pyodide 314.0.7, Python 3.14.2) run model-written code on arch without reaching
the network, the disk or the cluster? Run on 2026-11-10 with Deno 2.9.8 and Node 26.13.0. Throwaway: it decides
the design of `code_run`, then the tests move into the real code.

## Run it

```sh
mkdir -p dist && curl -sL https://registry.npmjs.org/pyodide/-/pyodide-314.0.7.tgz | tar xz -C dist && mv dist/package dist/pyodide
# Then the wheels for numpy, pandas, scipy and sympy from https://cdn.jsdelivr.net/pyodide/v314.0.7/full/ into
# dist/pyodide (file names from dist/pyodide/pyodide-lock.json; Pyodide checks their checksums when it loads them).
node run-cases.mjs            # every case under every host → results/cases.json
node warm.mjs                 # a started-ahead runner against a cold one → results/warm.json
```

- `runner.mjs`: one run. It reads `{code}` on stdin, loads Pyodide from `dist/` only, caps output at 64 KB, and prints
  one JSON line. `--warm` loads Pyodide, numpy and pandas first and waits.
- `run-cases.mjs`: each case is its own process, killed after 10 s. `node-open` has no restrictions and is the
  control: escapes succeed there, which shows the cases can tell.

## Results

**Network.** Under Deno with no `--allow-net`, and under Node with `--permission`, nothing got out: `fetch`,
`pyfetch`, WebSocket, Deno.connect, `net.connect`, DNS and `http.get`, to the internet, a cluster service
(`mcpgw.mcpgw.svc.cluster.local`), a ClusterIP (Loki) and the home LAN (192.168.1.163). From Python, `urllib`, `socket`
and `open_url` have no way out at all. The control reached every one of them.

- ⚠️ **Plain Deno still loads code from esm.sh and cdn.jsdelivr.net** through `import()`, since Deno allows a few code
  hosts by default. A URL like `https://esm.sh/x?leak=<data>` sends data out. `--no-remote --no-npm` blocks it.

**Host.** Locked Deno refused reading `/etc/passwd` and the repo, writing `/tmp`, env, running a command, FFI, the
Docker socket, and mounting the real disk into Python (NODEFS). Python's own files are Pyodide's in-memory ones.

- ⚠️ **Without the runtime's permissions, Pyodide is no sandbox:** in the control, `os.system("id")` ran on arch as the
  user, and Python mounted the real disk and read `/etc/passwd`. Under both locked hosts `os.system` crashes the run.
- ⚠️ **Node's permission model leaves env readable**, so a run must start with an empty env. Pyodide also needs
  `process.binding("constants")`, which Node's permission model refuses, so the runner answers that one call itself.
  Node's docs say the model "is not a defense against malicious code", and it had two bypass CVEs in 2026.
- Deno lets the code start a Worker, with the same permissions. It can't escalate, but it keeps the process alive
  until the kill.

**Limits.**

| Case | Result |
|---|---|
| Endless loop | Killed at the 10 s limit, every host |
| Python memory bomb | `MemoryError` at 4 GB by default. With `--wasm-max-mem-pages=16384`, `MemoryError` at 950 MB |
| JavaScript buffer bomb (outside the wasm cap) | In a container with 1.5 GB, the kernel killed that run, and the next run worked |
| 20 MB of output | Cut at 64 KB |
| Deep recursion | `RecursionError` |

**In a container shaped like the pod** (no network, 1.5 GB, read-only root, uid 1000): Deno with every permission
(`-A`) still couldn't fetch or import anything. That's the layer a NetworkPolicy gives, on top of Deno's.

**Speed and memory** (median of 3, arch):

| | Deno | Node |
|---|---|---|
| Cold start, plain Python | 1.7 s, 225 MB | 1.4 s, 200 MB |
| Cold, with numpy and pandas | 4.8 s, 430 MB | 4.1 s, 420 MB |
| Cold, with scipy and sympy | 9.5 s, 510 MB | 8.4 s, 600 MB |
| Started ahead (`--warm`), pandas price-per-TB | 48 ms | 50 ms |
| Started ahead, plain arithmetic | 26 ms | 33 ms |
| `sum(range(10**7))` / numpy 1000×1000 matmul | 0.5 s / 3.4 s | 0.5 s / 3.0 s |

The packages take 39 MB on disk with Pyodide. What Pyodide can't run: anything needing a native build that Pyodide
doesn't ship, such as PyTorch, and `pip install` at run time, since there's no network.
