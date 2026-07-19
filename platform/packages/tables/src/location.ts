export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

export interface ParsedLocationValue {
  label: string;
  coordinate: GeoCoordinate | null;
}

export interface ResolvedLocationCoordinate extends GeoCoordinate {
  displayLabel?: string;
}

export interface LocationResolutionResult {
  query: string;
  coordinate: ResolvedLocationCoordinate | null;
}

export interface LocationResolutionBatchOptions {
  labels: readonly string[];
  resolveBatch: (
    labels: string[],
  ) => Promise<readonly LocationResolutionResult[]>;
  onBatchResolved: (results: readonly LocationResolutionResult[]) => void;
  batchSize?: number;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinate(latitude: unknown, longitude: unknown): GeoCoordinate | null {
  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function coordinatePair(value: string): GeoCoordinate | null {
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const match = value.trim().match(new RegExp(`^(${number})\\s*,\\s*(${number})$`));
  return match ? coordinate(match[1], match[2]) : null;
}

function objectLocation(value: Record<string, unknown>): ParsedLocationValue | null {
  const label =
    typeof value["label"] === "string" && value["label"].trim()
      ? value["label"].trim()
      : typeof value["displayLabel"] === "string" && value["displayLabel"].trim()
        ? value["displayLabel"].trim()
        : "";

  if (value["type"] === "Point" && Array.isArray(value["coordinates"])) {
    const point = coordinate(value["coordinates"][1], value["coordinates"][0]);
    return point
      ? { label: label || `${point.latitude}, ${point.longitude}`, coordinate: point }
      : label
        ? { label, coordinate: null }
        : null;
  }

  const point = coordinate(
    value["latitude"] ?? value["lat"],
    value["longitude"] ?? value["lng"] ?? value["lon"],
  );
  if (point) {
    return {
      label: label || `${point.latitude}, ${point.longitude}`,
      coordinate: point,
    };
  }
  return label ? { label, coordinate: null } : null;
}

/**
 * Reads the canonical Location value shapes without geocoding:
 * - a human place label
 * - `latitude, longitude`
 * - `label | latitude, longitude`
 * - `[latitude, longitude]`
 * - `{ label?, latitude|lat, longitude|lng|lon }`
 * - GeoJSON Point (`coordinates` remain longitude, latitude)
 */
export function parseLocationValue(value: unknown): ParsedLocationValue | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return parseLocationValue(JSON.parse(trimmed));
      } catch {
        return { label: trimmed, coordinate: null };
      }
    }

    const delimiter = trimmed.lastIndexOf("|");
    if (delimiter >= 0) {
      const point = coordinatePair(trimmed.slice(delimiter + 1));
      if (point) {
        return {
          label:
            trimmed.slice(0, delimiter).trim() ||
            `${point.latitude}, ${point.longitude}`,
          coordinate: point,
        };
      }
    }

    const point = coordinatePair(trimmed);
    if (point) return { label: trimmed, coordinate: point };
    return { label: trimmed, coordinate: null };
  }

  if (Array.isArray(value)) {
    const point = coordinate(value[0], value[1]);
    return point
      ? { label: `${point.latitude}, ${point.longitude}`, coordinate: point }
      : null;
  }

  if (value && typeof value === "object") {
    return objectLocation(value as Record<string, unknown>);
  }
  return null;
}

export function formatLocationInput(value: unknown): string {
  const parsed = parseLocationValue(value);
  if (!parsed) return "";
  if (!parsed.coordinate) return parsed.label;
  return serializeLocationCoordinate(parsed.label, parsed.coordinate);
}

export function serializeLocationCoordinate(
  label: string,
  value: GeoCoordinate,
): string {
  const safeLabel = label.trim() || `${value.latitude}, ${value.longitude}`;
  return `${safeLabel} | ${value.latitude}, ${value.longitude}`;
}

export async function resolveLocationLabelsInBatches({
  labels,
  resolveBatch,
  onBatchResolved,
  batchSize = 20,
}: LocationResolutionBatchOptions): Promise<LocationResolutionResult[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Location resolution batch size must be a positive integer.");
  }

  const resolved: LocationResolutionResult[] = [];
  for (let index = 0; index < labels.length; index += batchSize) {
    const batch = await resolveBatch(labels.slice(index, index + batchSize));
    resolved.push(...batch);
    onBatchResolved(batch);
  }
  return resolved;
}
