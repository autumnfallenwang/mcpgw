// Downloads Pyodide and the packages code_run offers into one folder, and checks every file: the npm tarball against
// its pinned sha512, then each wheel against the sha256 in that tarball's pyodide-lock.json. Pyodide checks the wheels
// again when it loads them. The image build runs this, and so do CI and local development.
//   node code-runner/fetch-pyodide.mjs <out-dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PYODIDE_VERSION = "314.0.7";
const TARBALL = `https://registry.npmjs.org/pyodide/-/pyodide-${PYODIDE_VERSION}.tgz`;
const TARBALL_SHA512 =
  "0YvXxEhfEdpLfb/XkM2BFAeMROq0iMUX2bzzH9pOttyMcWkwq+HbE5uyuGD82LN7y2q+SNvi/6V5JEsOlD2R1A==";
const WHEELS = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
/** What code_run offers, with their dependencies. Anything else is a ModuleNotFoundError. */
export const PACKAGES = ["numpy", "pandas", "scipy", "sympy"];
/** In the npm tarball but not needed to run: the browser console, source maps, the UMD build. */
const UNNEEDED = [
  "console.html",
  "console-v2.html",
  "pyodide.js",
  "pyodide.js.map",
  "pyodide.mjs.map",
];

const out = process.argv[2];
if (!out) {
  console.error("usage: node fetch-pyodide.mjs <out-dir>");
  process.exit(2);
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const stamp = join(out, ".fetched");
if (
  existsSync(stamp) &&
  readFileSync(stamp, "utf8") === `${PYODIDE_VERSION} ${PACKAGES.join(" ")}`
) {
  console.log(`${out} already has Pyodide ${PYODIDE_VERSION}`);
  process.exit(0);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tarball = await download(TARBALL);
const sha512 = createHash("sha512").update(tarball).digest("base64");
if (sha512 !== TARBALL_SHA512)
  throw new Error(`pyodide tarball sha512 is ${sha512}, expected ${TARBALL_SHA512}`);
const tgz = join(out, "pyodide.tgz");
writeFileSync(tgz, tarball);
execFileSync("tar", ["xzf", tgz, "-C", out, "--strip-components=1"]);
rmSync(tgz);
for (const f of UNNEEDED) rmSync(join(out, f), { force: true });

const lock = JSON.parse(readFileSync(join(out, "pyodide-lock.json"), "utf8"));
const wanted = new Set();
const add = (name) => {
  const key = name.toLowerCase();
  if (wanted.has(key)) return;
  const pkg = lock.packages[key];
  if (!pkg) throw new Error(`${name} isn't in pyodide-lock.json`);
  wanted.add(key);
  for (const dep of pkg.depends) add(dep);
};
for (const name of PACKAGES) add(name);

for (const key of wanted) {
  const { file_name: file, sha256 } = lock.packages[key];
  const wheel = await download(WHEELS + file);
  const got = createHash("sha256").update(wheel).digest("hex");
  if (got !== sha256) throw new Error(`${file} sha256 is ${got}, expected ${sha256}`);
  writeFileSync(join(out, file), wheel);
  console.log(`${file} ok`);
}
writeFileSync(stamp, `${PYODIDE_VERSION} ${PACKAGES.join(" ")}`);
console.log(`Pyodide ${PYODIDE_VERSION} and ${wanted.size} packages in ${out}`);
