/**
 * Private geocoding port. Bridge never binds a public provider implicitly:
 * implementations must be installed explicitly and must resolve inside the
 * Local Plane so place labels do not become ambient cloud egress.
 */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

export interface GeocodingResult extends GeoCoordinate {
  displayLabel?: string;
}

export interface GeocodingAttribution {
  label: string;
  url: string;
}

export interface GeocodingProvider {
  readonly id: string;
  readonly plane: "local";
  readonly attribution?: GeocodingAttribution;
  geocode(request: { query: string }): Promise<GeocodingResult | null>;
}
