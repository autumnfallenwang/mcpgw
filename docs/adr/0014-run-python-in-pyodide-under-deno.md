# 0014: Run model-written Python in Pyodide under Deno, in its own pod

- **Status:** accepted, on the user's go on 2026-11-10 ("this is needed", then "go dev e2e for that").
- **Date:** 2026-11-10

## Context

Models do arithmetic and table work in their heads, and get it wrong. `code_run` lets a seat run Python instead: maths, price per TB
across drives, totals from a table on a fetched page. The code is written by a cloud model that may have read a hostile page, so it
must be treated as an attacker's. Inside the cluster nothing asks for a login (ADR 0008), so code that reaches the network reaches
llmgw, homestorm's API and the home network. The network is what matters most, then the host.

How others do it, from research on 2026-11-10:

- **The model vendors' own sandboxes** (Anthropic's code execution tool, OpenAI's Code Interpreter) run in their containers with no
  network. Each belongs to one vendor; homestorm's seats mix Claude, GPT and DeepSeek through llmgw.
- **Harnesses on a laptop** (Claude Code's sandbox-runtime, Codex CLI's bubblewrap and seccomp) protect one person's machine, not a
  service.
- **Sandbox platforms** use a microVM per run (E2B, on Firecracker) or gVisor (Modal). The hosted ones send code and data out;
  self-hosted E2B needs Nomad and Consul.
- **WebAssembly:** smolagents' WasmExecutor and Pydantic's mcp-run-python run Python compiled to WebAssembly (Pyodide) inside Deno.
- **Kubernetes:** kubernetes-sigs/agent-sandbox (v1.0.10, 2026-11-06) is a Sandbox resource for long-lived agent workspaces. It
  takes its isolation from gVisor or Kata, neither of which arch has.

## Decision

**Each run is a fresh Deno process, allowed only to read Pyodide, in a pod of its own that can reach nothing.**

- **Pyodide 314.0.7** (Python 3.14) with numpy, pandas, scipy and sympy, fetched at build time and checked against pinned hashes.
- **Deno is the boundary:** each run gets `--no-remote --no-npm` and `--allow-read` on Pyodide only, so no network, files, env,
  programs or FFI. The WebAssembly memory is capped at 1 GiB.
- **The pod is the second layer:** a NetworkPolicy lets it reach nothing, not even DNS, and only mcpgw reach it. It runs as a
  non-root user, with a read-only root, no capabilities, no service-account token, and a memory limit.
- **A process per run, never reused,** so nothing carries from one run to the next. Two are started ahead with numpy and pandas
  loaded, so a run waits about 50 ms instead of 1.5 to 5 s. Two run at once and the rest queue. A run is killed at 20 s.
- **mcpgw only sends code over HTTP** and holds no Kubernetes rights. The runner's image is built with mcpgw's, as
  `mcpgw:<commit>-code-runner`, so the one tag in arch-infra moves both.

## Alternatives considered

- **gVisor or Kata, with real CPython.** Stronger isolation, and any package works. Rejected for now: it needs gVisor installed on
  arch and k3s restarted, which are machine changes, and the tests below found no way out of the Deno sandbox. It's the upgrade path
  if seats need packages Pyodide lacks.
- **A pod per run.** Each run would get its own kernel boundary. Rejected: 3 to 7 s per run, and mcpgw would need the right to create
  pods, which anyone who took over mcpgw could then use.
- **Node instead of Deno as the host.** In the tests it blocked the same things, but its own docs say its permission model "is not a
  defense against malicious code", it had two bypass CVEs in 2026, it leaves env readable, and Pyodide only starts under it with a
  workaround in Node's internals.
- **Agent Sandbox.** Built for workspaces that persist, which `code_run` doesn't need, and it still needs gVisor or Kata.
- **A vendor's hosted sandbox.** Tied to one model vendor, and the code and data would leave the house.

## Consequences

- **Tested, in [dev/code-run-spike](../../dev/code-run-spike/README.md) and now `code-runner/sandbox_test.mjs`:**
  - **Network:** `fetch`, WebSocket, TCP, DNS, a unix socket and `import()` from a code host, to the internet, cluster services and
    the home LAN, were all refused. Without `--no-remote`, `import()` from esm.sh and jsdelivr got out.
  - **Files and programs:** Python never saw the real disk, could not run programs, and could not mount the disk.
  - **Limits:** an endless loop is killed, a Python memory bomb gets a MemoryError near 1 GB, and a JavaScript one is killed by the
    kernel at the pod's limit while the server and the next run carry on.
  - **The control proved the cases work:** with no permissions set, the same code reached everything, and `os.system("id")` ran on
    arch.
- **On the cluster, 2026-11-10:** from inside the pod, Deno with every permission reached nothing, so the NetworkPolicy holds
  on its own too. A throwaway pod reached mcpgw but not the runner. arch itself does reach the runner, since k3s lets the
  node's own traffic through, as it does for SearXNG.
- **Pyodide alone is no sandbox.** Deno's permissions are what hold, so a change to the runner's flags is a security change.
- **What can't run:** anything Pyodide doesn't ship (PyTorch, for one), `pip install`, and anything that needs the network. numpy is
  slow for big work: a 1000×1000 matrix multiply takes 3 s.
- **Memory:** about 0.7 GB idle for the two started ahead, and up to 3.5 GB while busy.
- **Logs keep sizes and the outcome,** never the code or its output, which may hold meeting content.
- **homestorm has to offer it to seats,** which is homestorm's own work.
