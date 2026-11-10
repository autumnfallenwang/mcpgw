// Time from sending the code to getting the result, when the runner was started ahead and is waiting (--warm), against
// a cold start. Writes results/warm.json.   node warm.mjs
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOSTS = {
  "deno-no-remote-1GiB": ["/usr/bin/deno", "run", "--no-prompt", "--no-config", "--no-remote", "--no-npm", "--v8-flags=--wasm-max-mem-pages=16384", `--allow-read=${HERE}`, "runner.mjs"],
  "node-1GiB": [process.execPath, "--permission", "--wasm-max-mem-pages=16384", `--allow-fs-read=${HERE}`, "runner.mjs"],
};
const CODE = {
  "price per TB with pandas": `import pandas as pd
df = pd.DataFrame({"drive": ["a", "b", "c"], "price": [199.0, 289.0, 449.0], "tb": [8, 12, 20]})
df["per_tb"] = (df.price / df.tb).round(2)
print(df.sort_values("per_tb").to_string(index=False))`,
  "plain arithmetic": `print(sum(x * 1.0825 for x in [19.99, 5.49, 120.00]))`,
};

function run(argv, code, warm) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], [...argv.slice(1), ...(warm ? ["--warm"] : [])], { cwd: HERE, env: {} });
    const spawned = performance.now();
    let buf = "";
    let sentAt = warm ? null : spawned;
    child.stdout.on("data", (d) => {
      buf += d;
      if (warm && sentAt === null && buf.includes("READY\n")) {
        // Started ahead: a real pool would have done this before the call arrived.
        sentAt = performance.now();
        child.stdin.end(JSON.stringify({ code }));
      }
    });
    if (!warm) child.stdin.end(JSON.stringify({ code }));
    child.on("close", () => {
      const done = performance.now();
      const last = JSON.parse(buf.trim().split("\n").pop());
      resolve({ ms: Math.round(done - sentAt), ok: last.ok, timings: last.timings, startup_ms: Math.round(sentAt - spawned) });
    });
  });
}

const out = {};
for (const [host, argv] of Object.entries(HOSTS)) {
  for (const [name, code] of Object.entries(CODE)) {
    for (const warm of [false, true]) {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await run(argv, code, warm));
      const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
      out[`${host} | ${name} | ${warm ? "warm" : "cold"}`] = { median_ms: ms[1], runs };
      console.log(`${host.padEnd(20)} ${name.padEnd(26)} ${warm ? "warm" : "cold"}  median ${String(ms[1]).padStart(5)} ms  (${ms.join(", ")})${runs.every((r) => r.ok) ? "" : "  NOT OK"}`);
    }
  }
}
writeFileSync(join(HERE, "results", "warm.json"), `${JSON.stringify({ date: new Date().toISOString(), out }, null, 2)}\n`);
