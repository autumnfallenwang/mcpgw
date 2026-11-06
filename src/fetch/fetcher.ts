import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { APP_VERSION } from "../config.js";
import { BlockedUrl, checkUrl, type FetchPolicy } from "./guard.js";

export interface FetchedPage {
  finalUrl: URL;
  /** Without parameters, lower case. */
  contentType: string;
  charset?: string;
  body: Buffer;
  /** Bytes read, after decompression. */
  bytes: number;
  /** The body went past the limit, and reading stopped there. */
  partial: boolean;
}

export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly host: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpFailure";
  }
}

export class FetchFailure extends Error {
  constructor(
    readonly kind: "timeout" | "dns" | "connect" | "too_many_redirects" | "bad_redirect",
    readonly host: string | null,
  ) {
    super(kind);
    this.name = "FetchFailure";
  }
}

export type LookupFn = typeof dnsLookup;

export interface FetcherOptions {
  policy: FetchPolicy;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  /** Tests swap this to play a DNS server that answers with whatever address they like. */
  lookup?: LookupFn;
}

/** text/markdown first: Cloudflare sites that opted in answer with Markdown, skipping extraction. */
const ACCEPT = "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1";

function causeOf<T extends Error>(err: unknown, type: new (...args: never[]) => T): T | undefined {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (e instanceof type) return e;
  }
  return undefined;
}

function errorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code) return code;
  }
  return undefined;
}

/**
 * Reads pages for `web_fetch`. Every connection resolves its name through a check of the actual
 * addresses, at connect time: a pre-check can't stop DNS rebinding, because the name could resolve
 * differently a moment later. Redirects are followed by hand, so every hop is checked again.
 */
export class Fetcher {
  private readonly agent: Agent;
  private readonly maxRedirects: number;

  constructor(private readonly options: FetcherOptions) {
    this.maxRedirects = options.maxRedirects ?? 5;
    const resolve = options.lookup ?? dnsLookup;
    const { policy } = options;

    const checkedLookup = ((
      hostname: string,
      lookupOptions: object,
      callback: (
        err: NodeJS.ErrnoException | null,
        address?: string | LookupAddress[],
        family?: number,
      ) => void,
    ) => {
      resolve(hostname, lookupOptions, (err, address, family) => {
        if (err) {
          callback(err);
          return;
        }
        const answers: string[] = Array.isArray(address)
          ? address.map((a) => a.address)
          : [address as unknown as string];
        // One bad answer fails the name: mixing public and private answers is what rebinding does.
        const blocked = answers.find((ip) => !policy.isAllowedAddress(ip));
        if (blocked) {
          callback(new BlockedUrl(`${hostname} resolves to private address ${blocked}`, hostname));
          return;
        }
        callback(null, address as string | LookupAddress[], family as number);
      });
    }) as LookupFn;

    this.agent = new Agent({ connect: { lookup: checkedLookup } });
  }

  async fetch(rawUrl: string, signal?: AbortSignal): Promise<FetchedPage> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let url = checkUrl(rawUrl, this.options.policy);

    for (let hop = 0; ; hop++) {
      try {
        const res = await undiciFetch(url, {
          dispatcher: this.agent,
          redirect: "manual",
          signal: combined,
          headers: {
            accept: ACCEPT,
            "accept-language": "en;q=1, *;q=0.5",
            "user-agent": `mcpgw/${APP_VERSION} (home tool gateway)`,
          },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel();
          if (!location) throw new FetchFailure("bad_redirect", url.hostname);
          if (hop >= this.maxRedirects) throw new FetchFailure("too_many_redirects", url.hostname);
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            throw new FetchFailure("bad_redirect", url.hostname);
          }
          url = checkUrl(next.href, this.options.policy);
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel();
          throw new HttpFailure(res.status, url.hostname);
        }

        const header = res.headers.get("content-type") ?? "";
        const contentType = header.split(";", 1)[0]!.trim().toLowerCase();
        const charset = /;\s*charset=["']?([^"';\s]+)/i.exec(header)?.[1];
        const { body, bytes, partial } = await this.readBody(
          res.body as ReadableStream<Uint8Array> | null,
        );
        return {
          finalUrl: url,
          contentType,
          ...(charset ? { charset } : {}),
          body,
          bytes,
          partial,
        };
      } catch (err) {
        if (
          err instanceof BlockedUrl ||
          err instanceof HttpFailure ||
          err instanceof FetchFailure
        ) {
          throw err;
        }
        const blocked = causeOf(err, BlockedUrl);
        if (blocked) throw blocked;
        if (combined.aborted) throw new FetchFailure("timeout", url.hostname);
        const code = errorCode(err);
        if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
          throw new FetchFailure("dns", url.hostname);
        }
        throw new FetchFailure("connect", url.hostname);
      }
    }
  }

  /** Counts what comes out of decompression, not the wire size, so a zip bomb stops at the limit. */
  private async readBody(stream: ReadableStream<Uint8Array> | null) {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let partial = false;
    if (stream) {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = this.options.maxBytes - bytes;
        if (value.length >= room) {
          chunks.push(value.subarray(0, room));
          bytes += room;
          partial = value.length > room;
          if (!partial) {
            const more = await reader.read();
            partial = !more.done;
          }
          await reader.cancel();
          break;
        }
        chunks.push(value);
        bytes += value.length;
      }
    }
    return { body: Buffer.concat(chunks), bytes, partial };
  }

  close(): Promise<void> {
    return this.agent.close();
  }
}
