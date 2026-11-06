import ipaddr from "ipaddr.js";

/** A URL or address `web_fetch` won't touch. The reason goes to the model and to the logs. */
export class BlockedUrl extends Error {
  constructor(
    readonly reason: string,
    readonly host: string | null,
  ) {
    super(reason);
    this.name = "BlockedUrl";
  }
}

export interface FetchPolicy {
  maxUrlChars: number;
  /** Is this resolved IP somewhere `web_fetch` may connect to? */
  isAllowedAddress(ip: string): boolean;
  isAllowedPort(port: number): boolean;
}

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/**
 * Only public addresses pass. `process` unwraps IPv4-mapped forms first, and every private,
 * loopback, link-local, multicast, NAT64 and reserved range classes as something other than
 * `unicast`. tests/guard.test.ts proves each one.
 */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  return ipaddr.process(ip).range() === "unicast";
}

export const DEFAULT_POLICY = (maxUrlChars: number): FetchPolicy => ({
  maxUrlChars,
  isAllowedAddress: isPublicAddress,
  isAllowedPort: (port) => ALLOWED_PORTS.has(port),
});

/** Names that only mean something inside a network. A DNS answer for them isn't to be trusted. */
const INTERNAL_SUFFIXES = [
  ".local",
  ".internal",
  ".svc",
  ".localhost",
  ".lan",
  ".home",
  ".intranet",
];
const INTERNAL_NAMES = new Set(["localhost", "metadata.google.internal"]);

function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

/**
 * Rules 1 to 4 of design §6.1, for everything knowable before connecting. The resolved address is
 * checked again at connect time (fetcher.ts), since a name can resolve anywhere.
 */
export function checkUrl(raw: string, policy: FetchPolicy): URL {
  if (raw.length > policy.maxUrlChars) {
    throw new BlockedUrl(`URL longer than ${policy.maxUrlChars} characters`, null);
  }

  let url: URL;
  try {
    // One parser only. WHATWG URL also normalizes tricks such as http://2130706433/ to 127.0.0.1.
    url = new URL(raw);
  } catch {
    throw new BlockedUrl("not a valid URL", null);
  }

  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrl(`scheme ${url.protocol.replace(":", "")} isn't allowed`, host || null);
  }
  if (url.username || url.password) {
    throw new BlockedUrl("credentials in the URL aren't allowed", host);
  }
  const port = url.port ? Number(url.port) : defaultPort(url.protocol);
  if (!policy.isAllowedPort(port)) throw new BlockedUrl(`port ${port} isn't allowed`, host);

  // Node doesn't call the DNS lookup for an IP written in the URL, so check those here.
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (ipaddr.isValid(literal)) {
    if (!policy.isAllowedAddress(literal))
      throw new BlockedUrl(`private address ${literal}`, literal);
    return url;
  }

  if (
    !host.includes(".") ||
    INTERNAL_NAMES.has(host) ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new BlockedUrl(`internal name ${host}`, host);
  }
  return url;
}
