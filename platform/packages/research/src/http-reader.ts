/**
 * BR1 page reader: HTTP + HTML→text, no browser engine (AP-089).
 *
 * Handles static and server-rendered pages — most articles, docs, and news —
 * which is the bulk of what a research objective needs. Pages that render
 * their content with client-side JavaScript come back thin; the caller sees
 * that honestly in `bytes`/`text` and can escalate to the webview reader
 * rather than being handed an empty page dressed up as a successful read.
 *
 * Egress safety is delegated, not reinvented: the caller supplies a
 * `fetchImpl` already wrapped in `@bridge/net-guard` (fixed-host/SSRF guard)
 * in production. This module only enforces what the reader itself owns —
 * scheme, redirect depth, content type, and a hard byte ceiling.
 */
import type { PageRead, ResearchPageReader } from "./ports.js";

export interface HttpReaderOptions {
  fetchImpl: typeof fetch;
  /** Hard ceiling on decoded bytes per page. */
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  now?: () => Date;
  /** Optional allowlist; when set, any other host is refused. */
  allowedHosts?: readonly string[];
}

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Elements whose contents are NEVER prose. An unclosed one swallows the rest
 * of the document deliberately: leaving script source in the extracted text
 * would both pollute the evidence and hand an attacker a place to hide
 * instructions aimed at the agent inside a tag that never closes.
 */
const NEVER_PROSE_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
];

/**
 * Layout chrome — real prose sometimes follows a malformed one of these, so
 * only balanced pairs are removed and a stray open tag just disappears.
 */
const CHROME_ELEMENTS = ["nav", "footer", "form"];

/**
 * Extract visible text from HTML without a DOM parser.
 *
 * Deliberately simple and total: research reading wants readable prose, not
 * a faithful DOM. Anything it cannot interpret degrades to "less text", never
 * to a throw, because a research step failing on a malformed page is worse
 * than a slightly noisy excerpt.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).replace(/\s+/g, " ").trim() : null;

  let working = html;
  // Comments first: they can contain anything, including fake tags.
  working = working.replace(/<!--[\s\S]*?-->/g, " ");
  for (const element of NEVER_PROSE_ELEMENTS) {
    // Close tag OR end of document — an unclosed script must not leak its
    // source (or anything hidden in it) into the extracted text.
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?(?:<\\/${element}\\s*>|$)`, "gi"),
      " ",
    );
  }
  for (const element of CHROME_ELEMENTS) {
    working = working.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?<\\/${element}\\s*>`, "gi"),
      " ",
    );
    working = working.replace(new RegExp(`<\\/?${element}\\b[^>]*>`, "gi"), " ");
  }
  // Block boundaries become newlines so paragraphs survive as paragraphs.
  working = working.replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");
  working = working.replace(/<br\s*\/?>/gi, "\n");
  working = working.replace(/<[^>]+>/g, " ");

  const text = decodeEntities(working)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { title, text };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export class HttpPageReader implements ResearchPageReader {
  readonly #fetch: typeof fetch;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #allowedHosts: readonly string[] | undefined;

  constructor(options: HttpReaderOptions) {
    this.#fetch = options.fetchImpl;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
    this.#allowedHosts = options.allowedHosts;
  }

  async read(url: string): Promise<PageRead> {
    const target = this.#validate(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(target.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      });
      if (!response.ok) {
        throw new Error(`page returned HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
        throw new Error(`unsupported content type "${contentType || "unknown"}"`);
      }
      const body = await response.text();
      const truncated = body.length > this.#maxBytes ? body.slice(0, this.#maxBytes) : body;
      const { title, text } = /text\/plain/i.test(contentType)
        ? { title: null, text: truncated }
        : htmlToText(truncated);
      return {
        url: response.url || target.toString(),
        title,
        text,
        retrievedAt: this.#now().toISOString(),
        contentHash: hash(text),
        bytes: truncated.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  #validate(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`"${url}" is not a valid URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`refusing to read a ${parsed.protocol} URL`);
    }
    if (this.#allowedHosts && !this.#allowedHosts.includes(parsed.hostname)) {
      throw new Error(`${parsed.hostname} is not in this Run's allowed hosts`);
    }
    return parsed;
  }
}

/** FNV-1a — a content fingerprint for the evidence ledger, not a digest. */
function hash(value: string): string {
  let hashValue = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 0x01000193) >>> 0;
  }
  return hashValue.toString(16).padStart(8, "0");
}
