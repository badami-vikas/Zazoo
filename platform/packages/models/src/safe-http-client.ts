import { Buffer } from "node:buffer";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import ipaddr from "ipaddr.js";

export type SafeHttpMethod = "GET" | "POST" | "DELETE";
export type SafeHttpErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_origin"
  | "blocked_address"
  | "dns_failed"
  | "timeout"
  | "redirect_blocked"
  | "too_many_redirects"
  | "response_too_large"
  | "invalid_content_type"
  | "invalid_encoding"
  | "transport_error";

export class SafeHttpError extends Error {
  readonly code: SafeHttpErrorCode;

  constructor(code: SafeHttpErrorCode, message: string) {
    super(message);
    this.name = "SafeHttpError";
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type SafeDnsResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface SafeTransportRequest {
  url: URL;
  method: SafeHttpMethod;
  headers: Readonly<Record<string, string>>;
  body?: string;
  resolvedAddress: string;
  family: 4 | 6;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface RawHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface SafeHttpTransport {
  request(input: SafeTransportRequest): Promise<RawHttpResponse>;
}

export interface SafeHttpRequest {
  url: string;
  method: SafeHttpMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: readonly string[];
  allowEmptyBody?: boolean;
}

export interface SafeHttpResponse {
  url: string;
  status: number;
  headers: Readonly<Record<string, string>>;
  contentType: string | null;
  body: string;
}

export interface SafeHttpClientPort {
  request(input: SafeHttpRequest): Promise<SafeHttpResponse>;
}

export interface SafeHttpClientOptions {
  resolver?: SafeDnsResolver;
  transport?: SafeHttpTransport;
  allowedOrigins: readonly string[];
  allowedContentTypes?: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024;
const DEFAULT_USER_AGENT = "Bridge/0.1 governed-web-research";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default.svc",
]);
const RESTRICTED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
]);

function stripAddressDecorations(address: string): string {
  const noZone = address.split("%", 1)[0] ?? address;
  return noZone.startsWith("[") && noZone.endsWith("]")
    ? noZone.slice(1, -1)
    : noZone;
}

function normalizedAddress(address: string): string | null {
  try {
    return ipaddr.process(stripAddressDecorations(address)).toNormalizedString();
  } catch {
    return null;
  }
}

export function isPublicUnicastAddress(address: string): boolean {
  try {
    return ipaddr.process(stripAddressDecorations(address)).range() === "unicast";
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return stripAddressDecorations(hostname).toLowerCase().replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isSafePublicCitationUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    isBlockedHostname(parsed.hostname)
  ) {
    return false;
  }
  const hostname = normalizeHostname(parsed.hostname);
  return isIP(hostname) === 0 || isPublicUnicastAddress(hostname);
}

const defaultResolver: SafeDnsResolver = async (hostname) => {
  try {
    const rows = await dnsLookup(hostname, { all: true, verbatim: true });
    return rows.flatMap((row) =>
      row.family === 4 || row.family === 6
        ? [{ address: row.address, family: row.family }]
        : [],
    );
  } catch {
    throw new SafeHttpError(
      "dns_failed",
      `safe HTTP: DNS resolution failed for ${hostname}`,
    );
  }
};

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[name.toLowerCase()] = value;
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
  }
  return normalized;
}

export function createPinnedLookup(
  address: string,
  family: 4 | 6,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

function createNodeTransport(): SafeHttpTransport {
  return {
    request(input) {
      return new Promise<RawHttpResponse>((resolve, reject) => {
        const lookup = createPinnedLookup(
          input.resolvedAddress,
          input.family,
        );
        const options: RequestOptions = {
          protocol: input.url.protocol,
          hostname: input.url.hostname,
          port: input.url.port || undefined,
          path: `${input.url.pathname}${input.url.search}`,
          method: input.method,
          headers: input.headers,
          agent: false,
          lookup,
          ...(input.url.protocol === "https:"
            ? { servername: normalizeHostname(input.url.hostname) }
            : {}),
        };
        const requestFn =
          input.url.protocol === "https:" ? httpsRequest : httpRequest;
        let totalTimer: NodeJS.Timeout;
        const req = requestFn(options, (res) => {
          const declaredLength = Number.parseInt(
            res.headers["content-length"] ?? "0",
            10,
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > input.maxResponseBytes
          ) {
            res.destroy(
              new SafeHttpError(
                "response_too_large",
                "safe HTTP: response exceeds the configured byte limit",
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;
          res.on("data", (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += bytes.byteLength;
            if (received > input.maxResponseBytes) {
              res.destroy(
                new SafeHttpError(
                  "response_too_large",
                  "safe HTTP: response exceeds the configured byte limit",
                ),
              );
              return;
            }
            chunks.push(bytes);
          });
          res.once("error", (error) => {
            clearTimeout(totalTimer);
            reject(error);
          });
          res.once("end", () => {
            clearTimeout(totalTimer);
            resolve({
              status: res.statusCode ?? 0,
              headers: responseHeaders(res.headers),
              body: Buffer.concat(chunks),
            });
          });
        });

        req.once("socket", (socket) => {
          socket.once("connect", () => {
            const remote = socket.remoteAddress;
            if (
              !remote ||
              !isPublicUnicastAddress(remote) ||
              normalizedAddress(remote) !==
                normalizedAddress(input.resolvedAddress)
            ) {
              req.destroy(
                new SafeHttpError(
                  "blocked_address",
                  "safe HTTP: connected socket did not match the pinned public address",
                ),
              );
            }
          });
        });
        req.once("error", (error) => {
          clearTimeout(totalTimer);
          reject(error);
        });
        totalTimer = setTimeout(() => {
          req.destroy(
            new SafeHttpError("timeout", "safe HTTP: request timed out"),
          );
        }, input.timeoutMs);
        req.setTimeout(input.timeoutMs, () => {
          req.destroy(
            new SafeHttpError("timeout", "safe HTTP: request timed out"),
          );
        });
        if (input.body !== undefined) req.write(input.body);
        req.end();
      });
    },
  };
}

function normalizeOrigin(value: string, allowHttp: boolean): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      (parsed.protocol !== "https:" &&
        !(allowHttp && parsed.protocol === "http:"))
    ) {
      throw new Error("blocked origin");
    }
    return parsed.origin;
  } catch {
    throw new SafeHttpError(
      "invalid_url",
      `safe HTTP: invalid allowed origin ${value}`,
    );
  }
}

function normalizeHeaders(
  input: Readonly<Record<string, string>> | undefined,
  userAgent: string,
  body: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input ?? {})) {
    const name = rawName.toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(name)) {
      throw new SafeHttpError("transport_error", "safe HTTP: invalid header name");
    }
    if (RESTRICTED_REQUEST_HEADERS.has(name)) {
      throw new SafeHttpError(
        "transport_error",
        `safe HTTP: caller may not set ${name}`,
      );
    }
    if (/[\r\n]/.test(rawValue) || rawValue.length > 8_192) {
      throw new SafeHttpError(
        "transport_error",
        `safe HTTP: invalid ${name} header value`,
      );
    }
    headers[name] = rawValue;
  }
  headers["user-agent"] ??= userAgent;
  headers["accept-encoding"] = "identity";
  if (body !== undefined) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  return headers;
}

async function withinDeadline<T>(
  operation: Promise<T>,
  remainingMs: number,
): Promise<T> {
  if (remainingMs <= 0) {
    throw new SafeHttpError("timeout", "safe HTTP: request timed out");
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SafeHttpError("timeout", "safe HTTP: request timed out"),
            ),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function contentTypeOf(headers: Readonly<Record<string, string>>): string | null {
  const value = headers["content-type"];
  if (!value) return null;
  return value.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function contentTypeAllowed(
  contentType: string,
  allowed: readonly string[],
): boolean {
  return allowed.some(
    (item) =>
      contentType === item ||
      (item === "application/json" && contentType.endsWith("+json")),
  );
}

export class SafeHttpClient implements SafeHttpClientPort {
  readonly #resolver: SafeDnsResolver;
  readonly #transport: SafeHttpTransport;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #allowedContentTypes: readonly string[];
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxRequestBytes: number;
  readonly #maxRedirects: number;
  readonly #allowHttp: boolean;
  readonly #userAgent: string;

  constructor(options: SafeHttpClientOptions) {
    this.#allowHttp = options.allowHttp ?? false;
    if (
      options.allowedOrigins.length === 0 ||
      !Number.isInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) ||
      (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0 ||
      !Number.isInteger(
        options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      ) ||
      (options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) <= 0 ||
      !Number.isInteger(options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES) ||
      (options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES) <= 0 ||
      !Number.isInteger(options.maxRedirects ?? 0) ||
      (options.maxRedirects ?? 0) < 0
    ) {
      throw new SafeHttpError(
        "transport_error",
        "safe HTTP: configured origins and numeric limits must be non-empty and bounded",
      );
    }
    this.#resolver = options.resolver ?? defaultResolver;
    this.#transport = options.transport ?? createNodeTransport();
    this.#allowedOrigins = new Set(
      options.allowedOrigins.map((origin) =>
        normalizeOrigin(origin, this.#allowHttp),
      ),
    );
    this.#allowedContentTypes = (
      options.allowedContentTypes ?? ["application/json"]
    ).map((value) => value.toLowerCase());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    this.#maxRedirects = options.maxRedirects ?? 0;
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async request(input: SafeHttpRequest): Promise<SafeHttpResponse> {
    const timeoutMs = input.timeoutMs ?? this.#timeoutMs;
    const maxResponseBytes =
      input.maxResponseBytes ?? this.#maxResponseBytes;
    const maxRedirects = input.maxRedirects ?? this.#maxRedirects;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > this.#timeoutMs ||
      !Number.isInteger(maxResponseBytes) ||
      maxResponseBytes <= 0 ||
      maxResponseBytes > this.#maxResponseBytes ||
      !Number.isInteger(maxRedirects) ||
      maxRedirects < 0 ||
      maxRedirects > this.#maxRedirects
    ) {
      throw new SafeHttpError(
        "transport_error",
        "safe HTTP: request may narrow, but not widen, configured limits",
      );
    }
    if (
      input.body !== undefined &&
      Buffer.byteLength(input.body) > this.#maxRequestBytes
    ) {
      throw new SafeHttpError(
        "response_too_large",
        "safe HTTP: request body exceeds the configured byte limit",
      );
    }

    const requestedTypes = (
      input.allowedContentTypes ?? this.#allowedContentTypes
    ).map((value) => value.toLowerCase());
    if (
      requestedTypes.some(
        (value) => !this.#allowedContentTypes.includes(value),
      )
    ) {
      throw new SafeHttpError(
        "invalid_content_type",
        "safe HTTP: request may not widen allowed response content types",
      );
    }

    const deadline = performance.now() + timeoutMs;
    return this.#requestHop(
      input,
      deadline,
      maxResponseBytes,
      maxRedirects,
      requestedTypes,
      0,
    );
  }

  async #requestHop(
    input: SafeHttpRequest,
    deadline: number,
    maxResponseBytes: number,
    maxRedirects: number,
    allowedContentTypes: readonly string[],
    redirectCount: number,
  ): Promise<SafeHttpResponse> {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new SafeHttpError("invalid_url", "safe HTTP: invalid URL");
    }
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.protocol !== "https:" && !(this.#allowHttp && url.protocol === "http:"))
    ) {
      throw new SafeHttpError(
        "blocked_scheme",
        "safe HTTP: only credential-free HTTPS URLs are allowed",
      );
    }
    if (
      this.#allowedOrigins.size > 0 &&
      !this.#allowedOrigins.has(url.origin)
    ) {
      throw new SafeHttpError(
        "blocked_origin",
        `safe HTTP: origin ${url.origin} is not allowlisted`,
      );
    }

    const hostname = normalizeHostname(url.hostname);
    if (isBlockedHostname(hostname)) {
      throw new SafeHttpError(
        "blocked_address",
        "safe HTTP: local and metadata hostnames are blocked",
      );
    }
    const remainingForDns = deadline - performance.now();
    if (remainingForDns <= 0) {
      throw new SafeHttpError("timeout", "safe HTTP: request timed out");
    }
    const resolved =
      isIP(hostname) === 0
        ? await withinDeadline(this.#resolver(hostname), remainingForDns)
        : [
            {
              address: hostname,
              family: isIP(hostname) as 4 | 6,
            },
          ];
    if (
      resolved.length === 0 ||
      resolved.some(
        (entry) =>
          isIP(stripAddressDecorations(entry.address)) !== entry.family ||
          !isPublicUnicastAddress(entry.address),
      )
    ) {
      throw new SafeHttpError(
        "blocked_address",
        "safe HTTP: DNS resolved to a non-public address",
      );
    }
    const selected = [...resolved].sort((a, b) => a.family - b.family)[0]!;

    const remainingForRequest = deadline - performance.now();
    if (remainingForRequest <= 0) {
      throw new SafeHttpError("timeout", "safe HTTP: request timed out");
    }
    const headers = normalizeHeaders(input.headers, this.#userAgent, input.body);
    let raw: RawHttpResponse;
    try {
      raw = await withinDeadline(
        this.#transport.request({
          url,
          method: input.method,
          headers,
          ...(input.body !== undefined ? { body: input.body } : {}),
          resolvedAddress: selected.address,
          family: selected.family,
          timeoutMs: remainingForRequest,
          maxResponseBytes,
        }),
        remainingForRequest,
      );
    } catch (error) {
      if (error instanceof SafeHttpError) throw error;
      throw new SafeHttpError(
        "transport_error",
        "safe HTTP: transport failed",
      );
    }

    if (raw.body.byteLength > maxResponseBytes) {
      throw new SafeHttpError(
        "response_too_large",
        "safe HTTP: response exceeds the configured byte limit",
      );
    }
    if (REDIRECT_STATUSES.has(raw.status)) {
      if (redirectCount >= maxRedirects) {
        throw new SafeHttpError(
          maxRedirects === 0 ? "redirect_blocked" : "too_many_redirects",
          "safe HTTP: redirect limit reached",
        );
      }
      if (input.method !== "GET") {
        throw new SafeHttpError(
          "redirect_blocked",
          "safe HTTP: redirects are not followed for non-GET requests",
        );
      }
      const location = raw.headers["location"];
      if (!location) {
        throw new SafeHttpError(
          "redirect_blocked",
          "safe HTTP: redirect omitted Location",
        );
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new SafeHttpError(
          "redirect_blocked",
          "safe HTTP: redirect Location is invalid",
        );
      }
      if (next.origin !== url.origin) {
        throw new SafeHttpError(
          "redirect_blocked",
          "safe HTTP: cross-origin redirects are blocked",
        );
      }
      return this.#requestHop(
        { ...input, url: next.toString() },
        deadline,
        maxResponseBytes,
        maxRedirects,
        allowedContentTypes,
        redirectCount + 1,
      );
    }

    const contentType = contentTypeOf(raw.headers);
    if (raw.body.byteLength > 0) {
      if (
        !contentType ||
        !contentTypeAllowed(contentType, allowedContentTypes)
      ) {
        throw new SafeHttpError(
          "invalid_content_type",
          "safe HTTP: response Content-Type is not allowed",
        );
      }
      const encoding = raw.headers["content-encoding"];
      if (encoding && encoding.toLowerCase() !== "identity") {
        throw new SafeHttpError(
          "invalid_encoding",
          "safe HTTP: compressed responses are not accepted",
        );
      }
    } else if (!input.allowEmptyBody) {
      throw new SafeHttpError(
        "invalid_content_type",
        "safe HTTP: response body is empty",
      );
    }

    let body: string;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(raw.body);
    } catch {
      throw new SafeHttpError(
        "invalid_encoding",
        "safe HTTP: response is not valid UTF-8",
      );
    }
    return {
      url: url.toString(),
      status: raw.status,
      headers: raw.headers,
      contentType,
      body,
    };
  }
}
