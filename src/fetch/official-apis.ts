/**
 * Sites that refuse mcpgw's requests but offer an official API, read through that API instead. Stack Overflow answered
 * 403 in both real meetings, so seats answered from memory. This isn't disguising mcpgw as a browser: it's the way
 * these sites ask programs to read them.
 */

/** What an API reader needs from mcpgw: the body of a URL, through the same guarded fetcher as any page. */
export interface ApiClient {
  json(url: string): Promise<unknown>;
  /** Null when the URL doesn't exist (HTTP 404). */
  text(url: string): Promise<string | null>;
}

export interface ApiDocument {
  title: string;
  /** The page the caller asked for, which is what a model should cite. */
  finalUrl: string;
  format: "html" | "markdown";
  content: string;
  /** Which API it came through, for the logs. */
  via: string;
}

export interface ApiReader {
  via: string;
  read(client: ApiClient): Promise<ApiDocument>;
}

/** Thrown when an API says the thing doesn't exist, so the caller gets the same message as a 404 page. */
export class ApiNotFound extends Error {
  constructor() {
    super("Not found through the official API");
    this.name = "ApiNotFound";
  }
}

// ── Stack Exchange ────────────────────────────────────────────────────────────────────────────────────────────────

const SE_API = "https://api.stackexchange.com/2.3";
const SE_SITES: Record<string, string> = {
  "stackoverflow.com": "stackoverflow",
  "superuser.com": "superuser",
  "serverfault.com": "serverfault",
  "askubuntu.com": "askubuntu",
  "mathoverflow.net": "mathoverflow",
  "stackapps.com": "stackapps",
};
const SE_SITE_NAMES: Record<string, string> = {
  stackoverflow: "Stack Overflow",
  superuser: "Super User",
  serverfault: "Server Fault",
  askubuntu: "Ask Ubuntu",
  mathoverflow: "MathOverflow",
};
const ANSWERS = 5;

/** The API's `site` parameter for a host, or null for a host that isn't a Stack Exchange site. */
export function stackExchangeSite(host: string): string | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (SE_SITES[h]) return SE_SITES[h];
  // ru.stackoverflow.com and the other language sites.
  const lang = /^([a-z]{2})\.stackoverflow\.com$/.exec(h);
  if (lang) return `${lang[1]}.stackoverflow`;
  const se = /^([a-z0-9-]+)\.stackexchange\.com$/.exec(h);
  if (se && se[1] !== "meta" && se[1] !== "api") return se[1]!;
  return null;
}

interface SeOwner {
  display_name?: string;
}
interface SePost {
  question_id?: number;
  answer_id?: number;
  title?: string;
  body?: string;
  score?: number;
  is_accepted?: boolean;
  answer_count?: number;
  tags?: string[];
  creation_date?: number;
  owner?: SeOwner;
  link?: string;
}
interface SeResponse {
  items?: SePost[];
  backoff?: number;
}

const day = (seconds?: number) =>
  seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : "an unknown date";

/** Text from the API, which arrives HTML-escaped, so it can go into the document as it is. */
const by = (owner?: SeOwner) => owner?.display_name ?? "a deleted user";

/**
 * The API can ask for a pause on one of its methods, such as /questions/{id}, after a burst. Honouring it is a
 * condition of using it.
 */
const seBackoffUntil = new Map<string, number>();

async function seGet(client: ApiClient, path: string): Promise<SePost[]> {
  const method = (path.split("?")[0] ?? path).replace(/\d+/g, "{id}");
  const until = seBackoffUntil.get(method) ?? 0;
  if (Date.now() < until) {
    throw new Error(`Stack Exchange asked mcpgw to wait until ${new Date(until).toISOString()}`);
  }
  const body = (await client.json(`${SE_API}${path}`)) as SeResponse;
  if (body.backoff) seBackoffUntil.set(method, Date.now() + body.backoff * 1000);
  return body.items ?? [];
}

function stackExchangeReader(url: URL, site: string): ApiReader | null {
  const match = /^\/(?:questions|q|a)\/(\d+)/.exec(url.pathname);
  if (!match) return null;
  const id = match[1]!;
  const isAnswer = url.pathname.startsWith("/a/");
  return {
    via: "stackexchange_api",
    async read(client) {
      let questionId = id;
      if (isAnswer) {
        const [answer] = await seGet(client, `/answers/${id}?site=${site}`);
        if (!answer?.question_id) throw new ApiNotFound();
        questionId = String(answer.question_id);
      }
      const [question] = await seGet(
        client,
        `/questions/${questionId}?site=${site}&filter=withbody`,
      );
      if (!question) throw new ApiNotFound();
      const answers = await seGet(
        client,
        `/questions/${questionId}/answers?site=${site}&filter=withbody&sort=votes&order=desc&pagesize=${ANSWERS}`,
      );
      const siteName = SE_SITE_NAMES[site] ?? url.hostname;
      const parts = [
        `<html><head><title>${question.title ?? "Question"}</title></head><body>`,
        `<h1>${question.title ?? "Question"}</h1>`,
        `<p>A question from ${siteName}, read through the Stack Exchange API. Asked by ${by(question.owner)} on ${day(question.creation_date)}. Score ${question.score ?? 0}, ${question.answer_count ?? answers.length} answers. Tags: ${(question.tags ?? []).join(", ") || "none"}. Content is CC BY-SA.</p>`,
        question.body ?? "",
      ];
      if (answers.length === 0) parts.push("<p>No answers yet.</p>");
      for (const a of answers) {
        const accepted = a.is_accepted ? ", the accepted answer" : "";
        parts.push(
          `<h2>Answer by ${by(a.owner)}: score ${a.score ?? 0}${accepted}</h2>`,
          a.body ?? "",
        );
      }
      if ((question.answer_count ?? 0) > answers.length) {
        parts.push(`<p>Only the ${answers.length} highest-voted answers are shown.</p>`);
      }
      parts.push("</body></html>");
      return {
        title: question.title ?? "Question",
        finalUrl: `https://${url.hostname}/questions/${questionId}`,
        format: "html",
        content: parts.join("\n"),
        via: "stackexchange_api",
      };
    },
  };
}

// ── npm ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const NPM_REGISTRY = "https://registry.npmjs.org";
/**
 * A package's published README. The registry only has it in the full package document, which is 6 MB for hono and
 * 16 MB for typescript, past what mcpgw reads. jsDelivr serves the published files themselves.
 */
const NPM_FILES = "https://cdn.jsdelivr.net/npm";
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const MAX_DEPENDENCIES = 30;

interface NpmManifest {
  name?: string;
  version?: string;
  description?: string;
  license?: string | { type?: string };
  homepage?: string;
  repository?: string | { url?: string };
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  deprecated?: string;
}

/** A path segment, or null when it isn't valid percent-encoding. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** HTML tags outside code, which a README uses for badges and layout. Code examples keep theirs. */
export function stripHtmlOutsideCode(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/<\/?[a-zA-Z][^>]*>/g, "")))
    .join("");
}

function npmReader(url: URL): ApiReader | null {
  const match = /^\/package\/((?:@[^/]+\/)?[^/]+)(?:\/v\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) return null;
  const name = decoded(match[1]!)?.toLowerCase();
  if (!name || !NPM_NAME.test(name)) return null;
  const asked = match[2] ? decoded(match[2]) : null;
  if (match[2] && !asked) return null;
  const path = name.replace("/", "%2F");
  return {
    via: "npm_registry",
    async read(client) {
      const tags = (await client.json(`${NPM_REGISTRY}/-/package/${path}/dist-tags`)) as Record<
        string,
        string
      >;
      if (!tags.latest) throw new ApiNotFound();
      const version = asked ?? tags.latest;
      if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new ApiNotFound();
      const m = (await client.json(`${NPM_REGISTRY}/${path}/${version}`)) as NpmManifest;
      const readme =
        (await client.text(`${NPM_FILES}/${name}@${version}/README.md`)) ??
        (await client.text(`${NPM_FILES}/${name}@${version}/readme.md`));

      const license = typeof m.license === "string" ? m.license : m.license?.type;
      const repo = typeof m.repository === "string" ? m.repository : m.repository?.url;
      const deps = Object.keys(m.dependencies ?? {});
      const otherTags = Object.entries(tags).filter(([t]) => t !== "latest");
      const lines = [
        `# ${name}`,
        "",
        "An npm package, read through the npm registry.",
        "",
        `- Latest version: ${tags.latest}`,
        ...(asked && asked !== tags.latest ? [`- This page's version: ${asked}`] : []),
        ...(otherTags.length
          ? [`- Other tags: ${otherTags.map(([t, v]) => `${t} ${v}`).join(", ")}`]
          : []),
        ...(m.deprecated ? [`- Deprecated: ${m.deprecated}`] : []),
        ...(license ? [`- License: ${license}`] : []),
        ...(m.homepage ? [`- Homepage: ${m.homepage}`] : []),
        ...(repo ? [`- Repository: ${repo.replace(/^git\+/, "")}`] : []),
        ...(m.engines
          ? [
              `- Engines: ${Object.entries(m.engines)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}`,
            ]
          : []),
        `- Dependencies: ${deps.length === 0 ? "none" : deps.slice(0, MAX_DEPENDENCIES).join(", ")}${deps.length > MAX_DEPENDENCIES ? `, and ${deps.length - MAX_DEPENDENCIES} more` : ""}`,
        ...(m.peerDependencies
          ? [`- Peer dependencies: ${Object.keys(m.peerDependencies).join(", ")}`]
          : []),
        "",
        m.description ?? "",
        "",
        "## README",
        "",
        readme
          ? stripHtmlOutsideCode(readme)
          : "This version has no README in its published files.",
      ];
      return {
        title: `${name} on npm`,
        finalUrl: asked
          ? `https://www.npmjs.com/package/${name}/v/${asked}`
          : `https://www.npmjs.com/package/${name}`,
        format: "markdown",
        content: lines.join("\n"),
        via: "npm_registry",
      };
    },
  };
}

/** The official API to read this URL through, or null to fetch it as a page. */
export function officialApiFor(raw: string): ApiReader | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const site = stackExchangeSite(url.hostname);
  if (site) return stackExchangeReader(url, site);
  const host = url.hostname.toLowerCase();
  if (host === "www.npmjs.com" || host === "npmjs.com") return npmReader(url);
  return null;
}

/** For tests: forget any pause Stack Exchange asked for. */
export function resetStackExchangeBackoff(): void {
  seBackoffUntil.clear();
}
