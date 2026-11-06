import { readFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf-8")) as {
  version: string;
};

export const APP_NAME = "mcpgw";
export const APP_VERSION: string = pkg.version;
/** The commit the image was built from (CI passes it as a build arg); null in dev. */
export const APP_COMMIT: string | null = env.MCPGW_COMMIT || null;

export const PORT = Number(env.PORT ?? 3002);
export const LOG_LEVEL = env.LOG_LEVEL ?? "info";

/** Host names callers may use. Anything else gets a 403, which is what stops DNS rebinding. */
export const ALLOWED_HOSTS = (
  env.ALLOWED_HOSTS ?? "mcpgw.arch.internal,mcpgw.mcpgw.svc.cluster.local"
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export const SEARCH_PROVIDER = env.SEARCH_PROVIDER ?? "searxng";
