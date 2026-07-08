/**
 * HttpCommonsClient — fetch adapter binding @bridge/core's `CommonsRegistry`
 * port to the Commons HTTP contract (services/commons/src/server.ts). Same
 * seam discipline as ModelProvider/PackageStore: consumers depend on the
 * port; the Bridge Cloud swap is COMMONS_URL config only. NOT yet wired into
 * the router/UI — the port exists so the install flow and Learning Agent can
 * adopt it without inventing a transport.
 */
import {
  CommonsPublishRejectedError,
  type CommonsListQuery,
  type CommonsListResult,
  type CommonsPackageDetail,
  type CommonsPackageEntry,
  type CommonsRegistry,
  type PackageManifest,
} from "@bridge/core";

export const DEFAULT_COMMONS_URL = "http://localhost:4780";

export function commonsUrlFromEnv(): string {
  return process.env.COMMONS_URL ?? DEFAULT_COMMONS_URL;
}

export class HttpCommonsClient implements CommonsRegistry {
  readonly #baseUrl: string;

  constructor(baseUrl: string = commonsUrlFromEnv()) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async listAvailable(query: CommonsListQuery = {}): Promise<CommonsListResult> {
    const params = new URLSearchParams();
    if (query.kind !== undefined) params.set("kind", query.kind);
    if (query.tag !== undefined) params.set("tag", query.tag);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.offset !== undefined) params.set("offset", String(query.offset));
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    const res = await fetch(`${this.#baseUrl}/v1/packages${qs}`);
    if (!res.ok) throw new Error(`commons list failed: ${res.status}`);
    return (await res.json()) as CommonsListResult;
  }

  async get(name: string): Promise<CommonsPackageDetail | null> {
    const res = await fetch(`${this.#baseUrl}/v1/packages/${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons get failed: ${res.status}`);
    return (await res.json()) as CommonsPackageDetail;
  }

  async getVersion(name: string, version: string): Promise<CommonsPackageEntry | null> {
    const res = await fetch(`${this.#baseUrl}/v1/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`commons getVersion failed: ${res.status}`);
    return (await res.json()) as CommonsPackageEntry;
  }

  async publish(manifest: PackageManifest, tags: string[] = []): Promise<{ name: string; version: string }> {
    const res = await fetch(`${this.#baseUrl}/v1/packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest, tags }),
    });
    if (res.status === 201) return (await res.json()) as { name: string; version: string };
    const body = (await res.json().catch(() => ({}))) as { message?: string; offendingPaths?: string[] };
    if (res.status === 422) {
      throw new CommonsPublishRejectedError(body.message ?? "workspace data rejected", body.offendingPaths ?? []);
    }
    throw new CommonsPublishRejectedError(body.message ?? `publish failed: ${res.status}`);
  }
}
