import type {
  GeocodingProvider,
  GeocodingResult,
} from "@bridge/core";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class LocalGeocodingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalGeocodingProviderError";
  }
}

export function assertLocalGeocoderUrl(value: string): URL {
  const url = new URL(value);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("BRIDGE_LOCAL_GEOCODER_URL must use a loopback host");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "BRIDGE_LOCAL_GEOCODER_URL cannot contain credentials, query parameters, or a fragment",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("BRIDGE_LOCAL_GEOCODER_URL must use HTTP or HTTPS");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export class LocalNominatimGeocodingProvider implements GeocodingProvider {
  readonly id = "local-nominatim";
  readonly plane = "local" as const;
  readonly attribution = {
    label: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
  };

  readonly #baseUrl: URL;
  readonly #fetcher: typeof fetch;

  constructor(options: { baseUrl: string; fetcher?: typeof fetch }) {
    this.#baseUrl = assertLocalGeocoderUrl(options.baseUrl);
    this.#fetcher = options.fetcher ?? globalThis.fetch;
  }

  async geocode(request: { query: string }): Promise<GeocodingResult | null> {
    const endpoint = new URL("search", this.#baseUrl);
    endpoint.searchParams.set("q", request.query);
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");

    const response = await this.#fetcher(endpoint, {
      headers: {
        accept: "application/json",
        "accept-language": "en",
        "user-agent": "Bridge/0.1 private-local-geocoder",
      },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.url && new URL(response.url).origin !== endpoint.origin) {
      throw new LocalGeocodingProviderError(
        "The private geocoder left its configured loopback origin.",
      );
    }
    if (!response.ok) {
      throw new LocalGeocodingProviderError(
        `The private geocoder returned HTTP ${response.status}.`,
      );
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new LocalGeocodingProviderError(
        "The private geocoder returned an invalid response.",
      );
    }
    if (body.length === 0) return null;
    const first = body[0];
    if (!first || typeof first !== "object") {
      throw new LocalGeocodingProviderError(
        "The private geocoder returned an invalid result.",
      );
    }
    const row = first as Record<string, unknown>;
    const latitude = Number(row["lat"]);
    const longitude = Number(row["lon"]);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new LocalGeocodingProviderError(
        "The private geocoder returned invalid coordinates.",
      );
    }
    return {
      latitude,
      longitude,
      ...(typeof row["display_name"] === "string"
        ? { displayLabel: row["display_name"] }
        : {}),
    };
  }
}

export function localGeocodingProviderFromEnv(
  env: NodeJS.ProcessEnv,
): GeocodingProvider | null {
  const baseUrl = env.BRIDGE_LOCAL_GEOCODER_URL?.trim();
  return baseUrl ? new LocalNominatimGeocodingProvider({ baseUrl }) : null;
}
