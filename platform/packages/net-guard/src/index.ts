/**
 * Fixed-host / SSRF egress guard — TASK-011 remediation (2026-07-17 security
 * review). Exports exactly ONE governed network primitive, `guardedFetch`,
 * which is the ONLY way any server-side code in this repo should perform an
 * outbound HTTP(S) fetch of an untrusted/candidate URL. There is no "check
 * then fetch separately" seam anymore — the address validated by DNS
 * resolution is the SAME address the socket connects to, closing the
 * TOCTOU/DNS-rebinding gap the previous `assertOutboundAllowed()` + plain
 * `fetch()` design had (the guard validated one resolution; `fetch()` then
 * resolved AGAIN internally, and followed redirects with NO validation at
 * all on the redirect target).
 *
 * How the pinning works: `https.request`/`http.request` accept a `lookup`
 * option — the function Node's own `net.Socket.connect` calls to resolve the
 * hostname into a connectable address. We supply a `lookup` that performs the
 * REAL DNS resolution, filters out every private/reserved/metadata address,
 * and returns ONLY vetted addresses to Node's connection machinery. Because
 * this is the ONE place resolution happens, there is no window between
 * "checked" and "connected" for DNS answers to change (rebinding) or for a
 * caller to bypass the check by hitting `fetch()` directly — `guardedFetch`
 * is the only exported thing that touches the network. The ORIGINAL hostname
 * (never a raw IP) is still passed to `https.request` as `host`/`servername`,
 * so TLS SNI and the `Host` header remain correct even though the connection
 * itself goes to the pinned, vetted address.
 *
 * Redirects are followed MANUALLY (`http`/`https.request` never auto-follows,
 * unlike `fetch`), one hop at a time, re-running the FULL guard (scheme,
 * credentials, hostname block-list, pinned DNS resolution) on every hop's
 * target before connecting to it — a redirect to a private/metadata address,
 * or a redirect cycle, is rejected exactly like a direct request to one would
 * be. `maxRedirects` bounds the hop count (default 3).
 *
 * Redirect safety (TASK-011 remediation, 2026-07-18 final review): every hop,
 * including the first, is checked against an OPTIONAL caller-supplied
 * `allowedRedirectOrigins` allowlist (`RedirectOriginNotAllowedError` if a hop
 * leaves it) — this is how a caller pins a fetch's RIGHTS classification
 * (e.g. "official company page") so an arbitrary public cross-origin redirect
 * cannot silently inherit that trust. An https:->http: downgrade on any hop
 * is always rejected regardless of the allowlist. Credential-bearing headers
 * (Authorization/Cookie/Proxy-Authorization/API-key-shaped) are stripped
 * before any CROSS-ORIGIN hop, matching browser fetch's own behavior (which
 * `http`/`https.request` does not replicate, since it never follows
 * redirects itself). The full in-order hop-origin chain is returned as
 * `hopOrigins` so a caller can independently re-verify it.
 *
 * DELIBERATELY its own module, not part of `@bridge/core`: `@bridge/core` is
 * isomorphic/browser-safe (imported by `@bridge/web`), while this module uses
 * `node:dns`/`node:net`/`node:http`/`node:https` and must NEVER be imported by
 * a browser bundle. Only server-side modules (apps/api) should depend on
 * `@bridge/net-guard`.
 *
 * Consolidating this with the still-separate `Tools/recon/lib/ssrf.ts` copy is
 * tracked as follow-up cleanup, not done here — Tools/recon is out of this
 * task's scope and this port changes none of its behavior.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";

const IPV4_BLOCKS: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xc6336400, 24], // 198.51.100.0/24
  [0xcb007100, 24], // 203.0.113.0/24
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

/**
 * Reuse/license intake (AP-008, 2026-07-17): evaluated `ipaddr.js@2.4.0`
 * (MIT, npm modified 2026-06-29, ~466M monthly downloads) and
 * `ip-address@10.2.0` (MIT, npm modified 2026-05-01, ~384M monthly
 * downloads). Both are well-maintained, but neither is a clean drop-in for
 * this guard's exact fail-closed policy without still carrying a local policy
 * table here: `ipaddr.js`'s canned ranges do not cover the full set we need,
 * and `ip-address` still omits deprecated site-local `fec0::/10`. Keep the
 * small hand-rolled block list, sourced from the IANA IPv6 Special-Purpose
 * Address Space registry plus RFC 3879, and keep IPv4-embedded IPv6 forms
 * delegated back to the canonical IPv4 block list below.
 */
const IPV6_BLOCKS: Array<[bigint, number]> = [
  ipv6Block("::", 128), // ::/128 — Unspecified Address (RFC 4291)
  ipv6Block("::1", 128), // ::1/128 — Loopback Address (RFC 4291)
  ipv6Block("64:ff9b:1::", 48), // 64:ff9b:1::/48 — NAT64 local-use prefix (RFC 8215)
  ipv6Block("100::", 64), // 100::/64 — Discard-Only Address Block (RFC 6666)
  ipv6Block("100:0:0:1::", 64), // 100:0:0:1::/64 — Dummy IPv6 Prefix (RFC 9780)
  ipv6Block("2001:2::", 48), // 2001:2::/48 — Benchmarking (RFC 5180)
  ipv6Block("2001:db8::", 32), // 2001:db8::/32 — Documentation (RFC 3849)
  ipv6Block("3fff::", 20), // 3fff::/20 — Documentation (RFC 9637)
  ipv6Block("5f00::", 16), // 5f00::/16 — SRv6 SIDs (RFC 9602)
  ipv6Block("fec0::", 10), // fec0::/10 — Deprecated site-local (RFC 3879)
  ipv6Block("fc00::", 7), // fc00::/7 — Unique Local Addresses (RFC 4193)
  ipv6Block("fe80::", 10), // fe80::/10 — Link-Local Unicast (RFC 4291)
  ipv6Block("ff00::", 8), // ff00::/8 — Multicast (RFC 4291)
];

const NAT64_WELL_KNOWN_PREFIX_96 = ipv6Block("64:ff9b::", 96)[0] >> 32n;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function inIpv4Block(ipInt: number, block: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (block & mask);
}

function ipv6Block(ip: string, prefix: number): [bigint, number] {
  const ipInt = parseIpv6(ip);
  if (ipInt === null) {
    throw new Error(`Invalid IPv6 policy block literal: ${ip}/${prefix}`);
  }
  return [ipInt, prefix];
}

function parseIpv6(ip: string): bigint | null {
  let normalized = normalizeHostname(ip);
  if (normalized.includes(".")) {
    const v4Match = normalized.match(/((?:\d+\.){3}\d+)$/);
    if (!v4Match?.[1]) return null;
    const v4Int = ipv4ToInt(v4Match[1]);
    if (v4Int === null) return null;
    normalized =
      `${normalized.slice(0, normalized.length - v4Match[1].length)}` +
      `${((v4Int >>> 16) & 0xffff).toString(16)}:${(v4Int & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = halves.length === 2 ? [...left, ...Array(gap).fill("0"), ...right] : left;
  if (groups.length !== 8 || gap < 0) return null;

  let out = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    out = (out << 16n) | BigInt(parseInt(group, 16));
  }
  return out;
}

function ipv4FromEmbeddedIpv6(ipv6: bigint): string | null {
  const prefix96 = ipv6 >> 32n;
  const isIpv4Compatible = prefix96 === 0n;
  const isIpv4Mapped = prefix96 === 0xffffn;
  const isNat64WellKnown = prefix96 === NAT64_WELL_KNOWN_PREFIX_96;

  if (!isIpv4Compatible && !isIpv4Mapped && !isNat64WellKnown) return null;
  if (isIpv4Compatible && (ipv6 === 0n || ipv6 === 1n)) return null;

  const v4 = Number(ipv6 & 0xffffffffn);
  return [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join(".");
}

function inIpv6Block(ipInt: bigint, block: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return ipInt >> shift === block >> shift;
}

/** True when a literal IP address falls in a private/reserved/metadata/loopback block. */
export function isBlockedIp(ip: string): boolean {
  const normalized = normalizeHostname(ip);

  if (isIP(normalized) === 4) {
    const ipInt = ipv4ToInt(normalized);
    return ipInt === null || IPV4_BLOCKS.some(([block, prefix]) => inIpv4Block(ipInt, block, prefix));
  }

  if (isIP(normalized) === 6) {
    const ipInt = parseIpv6(normalized);
    if (ipInt === null) return true;

    const embeddedIpv4 = ipv4FromEmbeddedIpv6(ipInt);
    if (embeddedIpv4) return isBlockedIp(embeddedIpv4);

    return IPV6_BLOCKS.some(([block, prefix]) => inIpv6Block(ipInt, block, prefix));
  }

  return false;
}

/** True for hostnames that resolve to "here" regardless of DNS (localhost/.local/.internal/cloud metadata). */
export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  );
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(`SSRF blocked: ${message}`);
    this.name = "SsrfBlockedError";
  }
}

export class RedirectLimitExceededError extends Error {
  constructor(maxRedirects: number) {
    super(`guardedFetch: exceeded max redirects (${maxRedirects})`);
    this.name = "RedirectLimitExceededError";
  }
}

export class RedirectCycleError extends Error {
  constructor(url: string) {
    super(`guardedFetch: redirect cycle detected at ${url}`);
    this.name = "RedirectCycleError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`guardedFetch: response exceeded max bytes (${maxBytes})`);
    this.name = "ResponseTooLargeError";
  }
}

export class RequestTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`guardedFetch: request body exceeded max bytes (${maxBytes})`);
    this.name = "RequestTooLargeError";
  }
}

export class RequestBodyRedirectError extends Error {
  constructor() {
    super("guardedFetch: requests with a body must set maxRedirects to 0");
    this.name = "RequestBodyRedirectError";
  }
}

/** A redirect hop left the caller-supplied `allowedRedirectOrigins` allowlist
 * — TASK-011 remediation (2026-07-18 coordinator final review, issue 3). This
 * is a DIFFERENT failure mode from `SsrfBlockedError`: the target may be a
 * perfectly public, non-private address, but the CALLER declared (via a
 * server-owned source registry, never client input) that only a specific set
 * of origins may be trusted with this fetch's rights classification (e.g.
 * "official company page"). An arbitrary public redirect off that allowlist
 * must not silently inherit that trust. */
export class RedirectOriginNotAllowedError extends Error {
  constructor(origin: string) {
    super(`guardedFetch: redirect to origin "${origin}" is not in the allowed redirect-origin set`);
    this.name = "RedirectOriginNotAllowedError";
  }
}

/** A redirect attempted to downgrade the connection from https: to http: —
 * always rejected, regardless of `allowedRedirectOrigins` (an allowlisted
 * origin does not license a scheme downgrade; downgrading exposes any
 * subsequently-sent bytes, including headers we did NOT strip because the
 * origin matched, to network-level tampering/interception). */
export class RedirectDowngradeError extends Error {
  constructor() {
    super("guardedFetch: redirect attempted to downgrade https: to http:");
    this.name = "RedirectDowngradeError";
  }
}

/** Request headers forwarded to a CROSS-ORIGIN redirect hop — TASK-011
 * remediation (2026-07-19 coordinator distributed-defects review, issue 12).
 * An EXPLICIT SAFE ALLOWLIST, not a denylist: only headers on this list ever
 * cross an origin boundary. A denylist can only ever block headers its
 * author thought of (the prior version missed things like
 * `X-Goog-Api-Key`/arbitrary custom API-key-shaped headers a caller might
 * set) — an allowlist fails closed for anything unrecognized, including
 * custom/vendor-specific credential headers no denylist could enumerate in
 * advance. Matched case-insensitively. Deliberately small: only headers that
 * are meaningful for a stateless, unauthenticated content fetch (this
 * primitive's actual use case) are included — nothing that could plausibly
 * carry a credential or session identifier. */
const CROSS_ORIGIN_ALLOWED_HEADERS: readonly string[] = ["accept", "accept-language", "user-agent", "content-type"];

function stripCrossOriginHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (CROSS_ORIGIN_ALLOWED_HEADERS.includes(key.toLowerCase())) allowed[key] = value;
  }
  return allowed;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

/** Test-only seam — production callers never set these; defaults to the real
 * SSRF block-list / real DNS. Named so misuse is obvious at every call site. */
export interface UnsafeTestOverrides {
  isBlockedIp?: (ip: string) => boolean;
  isBlockedHostname?: (hostname: string) => boolean;
  dnsLookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

/**
 * Resolve `hostname` and return ONLY vetted (non-blocked) addresses — the
 * function whose result becomes the actual TCP connection target. Throws
 * `SsrfBlockedError` if the hostname itself is blocked, or if EVERY resolved
 * address is blocked (no safe address to connect to).
 */
async function resolveGuardedAddresses(hostname: string, overrides?: UnsafeTestOverrides): Promise<ResolvedAddress[]> {
  const blockedHostname = overrides?.isBlockedHostname ?? isBlockedHostname;
  const blockedIp = overrides?.isBlockedIp ?? isBlockedIp;
  const normalized = normalizeHostname(hostname);

  if (blockedHostname(normalized)) {
    throw new SsrfBlockedError(`${normalized} is a private/reserved hostname`);
  }

  if (isIP(normalized)) {
    if (blockedIp(normalized)) {
      throw new SsrfBlockedError(`${normalized} is a private/reserved address`);
    }
    return [{ address: normalized, family: isIP(normalized) }];
  }

  const resolver = overrides?.dnsLookup ?? (async (h: string) => (await dnsLookup(h, { all: true })) as ResolvedAddress[]);
  const addresses = await resolver(normalized);
  const safe = addresses.filter((a) => !blockedIp(a.address));
  if (safe.length === 0) {
    throw new SsrfBlockedError(`${normalized} resolves only to private/reserved addresses`);
  }
  return safe;
}

function assertLawfulUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`unsupported URL scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("URLs carrying embedded credentials (userinfo) are rejected");
  }
}

export interface GuardedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Optional request body. The shared guard writes these exact bytes only
   * after URL/DNS validation and enforces `maxRequestBytes` before connecting. */
  body?: string | Buffer;
  /** Hard cap on request body bytes. */
  maxRequestBytes?: number;
  /** Overall per-hop timeout (each redirect hop gets a fresh timeout budget). */
  timeoutMs?: number;
  /** Max redirect hops to follow. 0 = never follow (reject on any 3xx).
   * Requests with a body must set this to 0 so bytes can never be replayed to
   * a redirect target. */
  maxRedirects?: number;
  /** Hard cap on response body bytes — enforced WHILE STREAMING, before the
   * body is ever fully buffered, and also pre-checked against a declared
   * Content-Length header before any body bytes are read. */
  maxBytes?: number;
  /** Caller-supplied cancellation — aborts the in-flight request/redirect
   * chain immediately (wired to a real Node socket abort, not merely a
   * promise rejection after the fact). */
  signal?: AbortSignal;
  /** When set, EVERY hop's origin (including the first request) must be a
   * member of this set or `guardedFetch` rejects with
   * `RedirectOriginNotAllowedError` — TASK-011 remediation (2026-07-18 final
   * review, issue 3). This is how a caller pins a fetch's RIGHTS
   * classification (e.g. "official company page") to a fixed set of origins
   * a redirect chain may traverse without silently escaping it via an
   * arbitrary public cross-origin redirect. Omit to allow any lawful
   * (non-SSRF-blocked) origin, same as before this option existed. */
  allowedRedirectOrigins?: readonly string[];
  /** Test-only — see `UnsafeTestOverrides`. Never set in production code. */
  unsafeTestOverrides?: UnsafeTestOverrides;
}

export interface GuardedFetchResult {
  finalUrl: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  redirectCount: number;
  /** Every origin (scheme+host+port) actually connected to, in hop order,
   * INCLUDING the first request — lets a caller verify (or re-verify) which
   * origins backed a fetch whose rights classification depends on staying
   * within an allowlist. */
  hopOrigins: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 2_000_000; // 2MB — generous for an HTML culture-research page, still bounded
const DEFAULT_MAX_REQUEST_BYTES = 64_000;

type NodeLookupCallback = (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void;

function performOneRequest(
  url: URL,
  addresses: ResolvedAddress[],
  options: {
    method: string;
    headers: Record<string, string>;
    body?: Buffer;
    timeoutMs: number;
    maxBytes: number;
    signal: AbortSignal;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    // The `lookup` override receives Node's OWN connection attempt for `url.hostname` —
    // we hand back ONLY the already-vetted addresses computed above, so the socket that
    // actually opens is guaranteed to be one we validated; no second, unguarded
    // resolution ever happens (this is what closes the TOCTOU/rebinding gap).
    const guardedLookup = (
      _hostname: string,
      opts: { all?: boolean } | NodeLookupCallback,
      cb?: NodeLookupCallback,
    ): void => {
      const callback = typeof opts === "function" ? opts : cb!;
      const wantsAll = typeof opts === "object" && opts !== null && opts.all === true;
      if (wantsAll) {
        callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
      } else {
        const first = addresses[0]!;
        callback(null, first.address, first.family);
      }
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname, // kept as the ORIGINAL hostname — correct TLS SNI + Host header
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        lookup: guardedLookup as unknown as typeof import("node:dns").lookup,
        signal: options.signal,
        timeout: options.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const declaredLength = res.headers["content-length"] ? Number(res.headers["content-length"]) : undefined;
        if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
          res.destroy();
          reject(new ResponseTooLargeError(options.maxBytes));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (truncated) {
            reject(new ResponseTooLargeError(options.maxBytes));
            return;
          }
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: false });
        });
        res.on("error", (err) => reject(err));
        res.on("close", () => {
          if (truncated) reject(new ResponseTooLargeError(options.maxBytes));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`guardedFetch: timed out after ${options.timeoutMs}ms`)));
    req.on("error", (err) => reject(err));
    req.end(options.body);
  });
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * The ONE governed outbound-fetch primitive. Validates scheme/credentials,
 * resolves + pins vetted DNS addresses (no separate re-resolution), performs
 * the request, and manually validates + follows a bounded number of
 * redirects — each hop re-run through the FULL guard before connecting.
 * Streams the response body under a hard byte cap. Wires `options.signal` for
 * real cancellation of an in-flight request.
 */
export async function guardedFetch(url: string, options: GuardedFetchOptions = {}): Promise<GuardedFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = options.method ?? "GET";
  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body, "utf8");
  if (body && body.byteLength > maxRequestBytes) {
    throw new RequestTooLargeError(maxRequestBytes);
  }
  if (body && maxRedirects !== 0) {
    throw new RequestBodyRedirectError();
  }
  const overrides = options.unsafeTestOverrides;
  const allowedRedirectOrigins = options.allowedRedirectOrigins ? new Set(options.allowedRedirectOrigins) : null;

  const visited = new Set<string>();
  const hopOrigins: string[] = [];
  let currentUrl: URL;
  try {
    currentUrl = new URL(url);
  } catch {
    throw new SsrfBlockedError("invalid URL");
  }
  // Current request headers — stripped of credential-bearing headers the
  // moment a hop crosses an origin boundary (TASK-011 remediation 2026-07-18
  // final review, issue 3). The FIRST hop keeps every caller-supplied header
  // (the caller addressed that origin directly and chose to send them).
  let currentHeaders = options.headers ?? {};

  let redirectCount = 0;
  for (;;) {
    assertLawfulUrl(currentUrl);
    const key = currentUrl.toString();
    if (visited.has(key)) {
      throw new RedirectCycleError(key);
    }
    visited.add(key);

    const origin = currentUrl.origin;
    if (allowedRedirectOrigins && !allowedRedirectOrigins.has(origin)) {
      throw new RedirectOriginNotAllowedError(origin);
    }
    hopOrigins.push(origin);

    const combinedSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const addresses = await waitWithAbort(
      resolveGuardedAddresses(currentUrl.hostname, overrides),
      combinedSignal,
    );

    const result = await performOneRequest(currentUrl, addresses, {
      method,
      headers: {
        ...currentHeaders,
        ...(body ? { "content-length": String(body.byteLength) } : {}),
        host: currentUrl.host,
      },
      ...(body ? { body } : {}),
      timeoutMs,
      maxBytes,
      signal: combinedSignal,
    });

    if (result.status >= 300 && result.status < 400 && result.headers.location) {
      if (redirectCount >= maxRedirects) {
        throw new RedirectLimitExceededError(maxRedirects);
      }
      redirectCount += 1;
      let nextUrl: URL;
      try {
        nextUrl = new URL(result.headers.location, currentUrl);
      } catch {
        throw new SsrfBlockedError(`redirect Location header is not a valid URL: ${result.headers.location}`);
      }
      // Reject any https: -> http: downgrade unconditionally — an allowed
      // redirect origin does not license sending subsequent bytes (including
      // whatever headers survive stripping) over a plaintext connection.
      if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
        throw new RedirectDowngradeError();
      }
      // Cross-origin hop: strip credential-bearing headers before the NEXT
      // request goes out, matching browser fetch's own cross-origin redirect
      // behavior (which Node's http/https.request does not do for us, since
      // it never follows redirects itself).
      if (nextUrl.origin !== currentUrl.origin) {
        currentHeaders = stripCrossOriginHeaders(currentHeaders);
      }
      currentUrl = nextUrl;
      continue;
    }

    return {
      finalUrl: currentUrl.toString(),
      status: result.status,
      headers: result.headers,
      body: result.body,
      truncated: result.truncated,
      redirectCount,
      hopOrigins,
    };
  }
}
