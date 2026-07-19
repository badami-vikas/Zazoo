import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  LocateFixed,
  MapPin,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  applyFilters,
  applySorts,
  formatLocationInput,
  parseLocationValue,
  resolveLocationLabelsInBatches,
  serializeLocationCoordinate,
  type ColumnSpec,
  type GeoCoordinate,
} from "@bridge/tables";
import countries from "world-atlas/countries-110m.json";
import { feature } from "topojson-client";
import type { GeoJsonObject } from "geojson";
import type { Topology } from "topojson-specification";
import { PILOT_ORGANIZATION, trpc } from "../../lib/trpc.js";
import { Button } from "../../components/ui/button.js";
import type { DataRow, DataViewProps } from "../types.js";

type Leaflet = typeof import("leaflet");

interface PlacedRecord {
  key: string;
  rowId: string | null;
  title: string;
  searchText: string;
  locationLabel: string;
  coordinate: GeoCoordinate;
  row: DataRow;
  source: "stored" | "resolved";
}

interface LocalResolution {
  coordinate: GeoCoordinate;
  displayLabel?: string;
}

interface GeocoderStatus {
  loading: boolean;
  available: boolean;
  providerId: string | null;
  attribution: { label: string; url: string } | null;
  error: string | null;
}

interface MapState {
  L: Leaflet;
  map: import("leaflet").Map;
  clusterLayer: import("leaflet").LayerGroup;
  pinLayer: import("leaflet").LayerGroup;
}

const CLUSTER_MIN = 10;
const POPUP_RECORD_LIMIT = 50;
const topology = countries as unknown as Topology;
const countryObject = topology.objects["countries"];
const localCountryFeatures = feature(
  topology,
  countryObject,
) as unknown as GeoJsonObject;

function normalizedLabel(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function displayTitle(
  row: DataRow,
  index: number,
  columns: readonly ColumnSpec[],
): string {
  const titleColumns = [
    ...columns.filter((column) => column.kind === "text" && column.id !== "id"),
    ...columns.filter(
      (column) =>
        column.id !== "id" &&
        (column.kind === "select" || column.kind === "url"),
    ),
  ];
  for (const column of titleColumns) {
    const value = scalarText(row[column.id]);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const id = recordId(row);
  if (id) return id;
  return `Record ${index + 1}`;
}

function recordSearchText(
  row: DataRow,
  columns: readonly ColumnSpec[],
  title: string,
): string {
  const values = columns.flatMap((column) => {
    const value =
      column.kind === "location"
        ? formatLocationInput(row[column.id])
        : row[column.id];
    if (Array.isArray(value)) {
      return value.flatMap((item) => scalarText(item) ?? []);
    }
    return scalarText(value) ?? [];
  });
  return [title, ...values].join(" ").toLocaleLowerCase("en-US");
}

function recordId(row: DataRow): string | null {
  const value = row["id"];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function recordsPopupHtml(records: PlacedRecord[], canOpen: boolean): string {
  const visible = records.slice(0, POPUP_RECORD_LIMIT);
  return `
    <div style="font-family:system-ui,sans-serif;min-width:190px;max-height:300px;overflow-y:auto;padding:2px 0">
      ${
        records.length > 1
          ? `<div style="font-weight:700;font-size:12px;color:#1a2b3c;margin-bottom:6px">${records.length} Records at this location</div>`
          : ""
      }
      ${visible
        .map(
          (record) => `
            <div style="padding:5px 0;border-bottom:1px solid #edf0f2">
              <div style="font-weight:700;font-size:13px;color:#1a2b3c;margin-bottom:2px">${escapeHtml(record.title)}</div>
              <div style="font-size:11px;color:#6b6860;margin-bottom:4px">${escapeHtml(record.locationLabel)}</div>
              <div style="font-size:10px;color:#7b8790;margin-bottom:${canOpen ? "6px" : "0"}">${record.source === "stored" ? "Stored coordinates" : "Resolved in this Local Plane session"}</div>
              ${
                canOpen
                  ? `<button data-map-record="${encodeURIComponent(record.key)}" style="font-size:11px;color:#315f7d;font-weight:600;background:none;border:none;padding:0;cursor:pointer">Open Record</button>`
                  : ""
              }
            </div>`,
        )
        .join("")}
      ${
        records.length > POPUP_RECORD_LIMIT
          ? `<div style="font-size:10px;color:#7b8790;padding-top:6px">Showing ${POPUP_RECORD_LIMIT} of ${records.length}. Use search to open another Record.</div>`
          : ""
      }
    </div>`;
}

function clusterPlaced(records: PlacedRecord[], zoom: number) {
  const cell = 360 / Math.pow(2, Math.max(1, zoom));
  const groups = new Map<string, PlacedRecord[]>();
  for (const record of records) {
    const key = `${Math.floor(record.coordinate.latitude / cell)},${Math.floor(record.coordinate.longitude / cell)}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const clusters: Array<{
    latitude: number;
    longitude: number;
    count: number;
    bounds: [[number, number], [number, number]];
    records: PlacedRecord[];
  }> = [];
  const singles: PlacedRecord[] = [];
  for (const group of groups.values()) {
    if (group.length < CLUSTER_MIN) {
      singles.push(...group);
      continue;
    }
    const latitudes = group.map((record) => record.coordinate.latitude);
    const longitudes = group.map((record) => record.coordinate.longitude);
    clusters.push({
      latitude:
        latitudes.reduce((sum, latitude) => sum + latitude, 0) /
        latitudes.length,
      longitude:
        longitudes.reduce((sum, longitude) => sum + longitude, 0) /
        longitudes.length,
      count: group.length,
      records: group,
      bounds: [
        [Math.min(...latitudes), Math.min(...longitudes)],
        [Math.max(...latitudes), Math.max(...longitudes)],
      ],
    });
  }
  return { clusters, singles };
}

function installLocalBasemap(L: Leaflet, map: import("leaflet").Map) {
  L.geoJSON(localCountryFeatures, {
    interactive: false,
    style: {
      color: "#a8b3bd",
      weight: 0.7,
      fillColor: "#e7ece8",
      fillOpacity: 1,
    },
  }).addTo(map);

  const gridStyle: import("leaflet").PathOptions = {
    color: "#cfd8df",
    weight: 0.45,
    opacity: 0.7,
    interactive: false,
  };
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    L.polyline(
      [
        [latitude, -180],
        [latitude, 180],
      ],
      gridStyle,
    ).addTo(map);
  }
  for (let longitude = -150; longitude <= 150; longitude += 30) {
    L.polyline(
      [
        [-85, longitude],
        [85, longitude],
      ],
      gridStyle,
    ).addTo(map);
  }
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    '<a href="https://github.com/topojson/world-atlas" target="_blank" rel="noreferrer">Local world-atlas basemap</a>',
  );
}

export function MapView({
  spec,
  view,
  data,
  onOpenRecord,
  onUpdate,
  canUpdateRow,
}: DataViewProps) {
  const locationColumn =
    spec.columns.find((column) => column.id === view.locationBy) ??
    spec.columns.find((column) => column.kind === "location");
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapStateRef = useRef<MapState | null>(null);
  const placedRef = useRef<PlacedRecord[]>([]);
  const canOpenRef = useRef(Boolean(onOpenRecord));
  const didFitRef = useRef(false);
  const [resolutions, setResolutions] = useState<
    Record<string, LocalResolution>
  >({});
  const [geocoderStatus, setGeocoderStatus] = useState<GeocoderStatus>({
    loading: false,
    available: false,
    providerId: null,
    attribution: null,
    error: null,
  });
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [resolutionMessage, setResolutionMessage] = useState<string | null>(
    null,
  );
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedRecordKeys, setSavedRecordKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  canOpenRef.current = Boolean(onOpenRecord);

  const visibleRows = useMemo(
    () => {
      const originalRows = new Map<DataRow, DataRow>();
      const projectedRows = data.map((row) => {
        const projected = { ...row };
        for (const column of spec.columns) {
          if (column.kind === "location") {
            projected[column.id] = formatLocationInput(row[column.id]);
          }
        }
        originalRows.set(projected, row);
        return projected;
      });
      return applySorts(
        applyFilters(projectedRows, view.rowFilters, view.filterMatch),
        view.sorts,
      ).map((row) => originalRows.get(row) ?? row);
    },
    [data, spec.columns, view.filterMatch, view.rowFilters, view.sorts],
  );

  const parsedRows = useMemo(() => {
    if (!locationColumn) return [];
    return visibleRows.map((row, index) => {
      const parsed = parseLocationValue(row[locationColumn.id]);
      const title = displayTitle(row, index, spec.columns);
      return {
        key: `${recordId(row) ?? "row"}:${index}`,
        rowId: recordId(row),
        title,
        searchText: recordSearchText(row, spec.columns, title),
        row,
        parsed,
      };
    });
  }, [locationColumn, spec.columns, visibleRows]);

  const placed = useMemo<PlacedRecord[]>(() => {
    const records: PlacedRecord[] = [];
    for (const item of parsedRows) {
      if (!item.parsed) continue;
      const local = resolutions[normalizedLabel(item.parsed.label)];
      const coordinate = item.parsed.coordinate ?? local?.coordinate;
      if (!coordinate) continue;
      records.push({
        key: item.key,
        rowId: item.rowId,
        title: item.title,
        searchText: item.searchText,
        locationLabel: item.parsed.label,
        coordinate,
        row: item.row,
        source: item.parsed.coordinate ? "stored" : "resolved",
      });
    }
    return records;
  }, [parsedRows, resolutions]);
  placedRef.current = placed;

  const unresolvedLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of parsedRows) {
      if (!item.parsed?.coordinate) {
        const label = item.parsed?.label;
        if (!label) continue;
        const key = normalizedLabel(label);
        if (!resolutions[key] && !labels.has(key)) labels.set(key, label);
      }
    }
    return [...labels.values()];
  }, [parsedRows, resolutions]);
  const unresolvedKey = unresolvedLabels
    .map(normalizedLabel)
    .sort()
    .join("\n");

  const saveCandidates = useMemo(() => {
    return parsedRows.filter((item) => {
      if (
        !item.rowId ||
        !item.parsed ||
        item.parsed.coordinate ||
        (canUpdateRow && !canUpdateRow(item.row)) ||
        savedRecordKeys.has(item.key)
      ) {
        return false;
      }
      return Boolean(resolutions[normalizedLabel(item.parsed.label)]);
    });
  }, [canUpdateRow, parsedRows, resolutions, savedRecordKeys]);

  useEffect(() => {
    if (!locationColumn || unresolvedLabels.length === 0) return;
    let active = true;
    setGeocoderStatus((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    void trpc.view.geocoderStatus
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((status) => {
        if (!active) return;
        setGeocoderStatus({
          loading: false,
          available: status.available,
          providerId: status.providerId,
          attribution: status.attribution,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGeocoderStatus({
          loading: false,
          available: false,
          providerId: null,
          attribution: null,
          error:
            error instanceof Error
              ? error.message
              : "Could not inspect the private geocoder.",
        });
      });
    return () => {
      active = false;
    };
  }, [locationColumn, statusAttempt, unresolvedKey]);

  useEffect(() => {
    if (!mapElementRef.current || mapStateRef.current) return;
    let disposed = false;
    void (async () => {
      const [{ default: L }] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      if (disposed || !mapElementRef.current) return;
      const map = L.map(mapElementRef.current, {
        preferCanvas: true,
        zoomControl: true,
        minZoom: 1,
        maxZoom: 18,
      }).setView([20, 0], 2);
      didFitRef.current = false;
      map.getContainer().style.background = "#dce8ef";
      installLocalBasemap(L, map);
      const clusterLayer = L.layerGroup().addTo(map);
      const pinLayer = L.layerGroup().addTo(map);
      mapStateRef.current = { L, map, clusterLayer, pinLayer };
      map.on("zoomend", renderMarkers);
      renderMarkers();
    })();

    return () => {
      disposed = true;
      const state = mapStateRef.current;
      if (state) {
        state.map.off("zoomend", renderMarkers);
        state.map.remove();
        mapStateRef.current = null;
      }
    };
  }, [locationColumn?.id]);

  function renderMarkers() {
    const state = mapStateRef.current;
    if (!state) return;
    const { L, map, clusterLayer, pinLayer } = state;
    clusterLayer.clearLayers();
    pinLayer.clearLayers();
    const { clusters, singles } = clusterPlaced(
      placedRef.current,
      map.getZoom(),
    );

    for (const cluster of clusters) {
      const size = cluster.count > 999 ? 56 : cluster.count > 99 ? 48 : 40;
      const icon = L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#315f7d;border:3px solid rgba(49,95,125,.28);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.18)">${cluster.count > 999 ? "999+" : cluster.count}</div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker(
        [cluster.latitude, cluster.longitude],
        { icon },
      );
      marker.bindPopup(recordsPopupHtml(cluster.records, canOpenRef.current), {
        maxWidth: 320,
      });
      marker.on("click", () => {
        const sameCoordinate =
          cluster.bounds[0][0] === cluster.bounds[1][0] &&
          cluster.bounds[0][1] === cluster.bounds[1][1];
        if (sameCoordinate || map.getZoom() >= map.getMaxZoom()) {
          marker.openPopup();
          return;
        }
        map.fitBounds(cluster.bounds, {
          padding: [60, 60],
          maxZoom: map.getZoom() + 3,
        });
      });
      marker.addTo(clusterLayer);
    }

    const colocated = new Map<string, PlacedRecord[]>();
    for (const record of singles) {
      const key = `${record.coordinate.latitude},${record.coordinate.longitude}`;
      const group = colocated.get(key);
      if (group) group.push(record);
      else colocated.set(key, [record]);
    }

    for (const records of colocated.values()) {
      const record = records[0];
      if (!record) continue;
      const marker = L.circleMarker(
        [record.coordinate.latitude, record.coordinate.longitude],
        {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#315f7d",
          fillOpacity: 0.95,
        },
      );
      marker.bindPopup(recordsPopupHtml(records, canOpenRef.current), {
        maxWidth: 320,
      });
      marker.addTo(pinLayer);
    }

    if (placedRef.current.length > 0 && !didFitRef.current) {
      didFitRef.current = true;
      const bounds = L.latLngBounds(
        placedRef.current.map((record) => [
          record.coordinate.latitude,
          record.coordinate.longitude,
        ]),
      );
      map.fitBounds(bounds.pad(0.2), { maxZoom: 10 });
    }
  }

  useEffect(() => {
    renderMarkers();
  }, [placed]);

  useEffect(() => {
    const element = mapElementRef.current;
    if (!element || !onOpenRecord) return;
    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-map-record]",
      );
      if (!target) return;
      const key = decodeURIComponent(target.dataset["mapRecord"] ?? "");
      const record = placedRef.current.find((candidate) => candidate.key === key);
      if (record) onOpenRecord(record.row);
    };
    element.addEventListener("click", handleClick);
    return () => element.removeEventListener("click", handleClick);
  }, [onOpenRecord]);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-US");
    if (!normalized) return [];
    return placed
      .filter((record) => record.searchText.includes(normalized))
      .slice(0, 12);
  }, [placed, query]);

  async function resolveLocally() {
    if (unresolvedLabels.length === 0) return;
    setResolving(true);
    setResolutionError(null);
    setResolutionMessage(null);
    let resolvedCount = 0;
    let notFound = 0;
    try {
      await resolveLocationLabelsInBatches({
        labels: unresolvedLabels,
        resolveBatch: async (labels) => {
          const result = await trpc.view.resolveLocations.mutate({
            organizationId: PILOT_ORGANIZATION,
            labels,
            confirmedLocalProvider: true,
          });
          return result.results;
        },
        onBatchResolved: (results) => {
          const batch: Record<string, LocalResolution> = {};
          for (const item of results) {
            if (!item.coordinate) {
              notFound += 1;
              continue;
            }
            batch[normalizedLabel(item.query)] = {
              coordinate: {
                latitude: item.coordinate.latitude,
                longitude: item.coordinate.longitude,
              },
              ...(item.coordinate.displayLabel
                ? { displayLabel: item.coordinate.displayLabel }
                : {}),
            };
          }
          resolvedCount += Object.keys(batch).length;
          setResolutions((current) => ({ ...current, ...batch }));
        },
      });
      setResolutionMessage(
        `${resolvedCount} ${resolvedCount === 1 ? "place" : "places"} resolved locally${notFound > 0 ? `; ${notFound} not found` : ""}.`,
      );
    } catch (error) {
      setResolutionError(
        `${resolvedCount > 0 ? `${resolvedCount} ${resolvedCount === 1 ? "place was" : "places were"} resolved before the provider stopped. ` : ""}${
          error instanceof Error
            ? error.message
            : "The private geocoder could not resolve these labels."
        }`,
      );
    } finally {
      setResolving(false);
    }
  }

  async function saveResolvedCoordinates() {
    if (!locationColumn || !onUpdate || saveCandidates.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    let saved = 0;
    try {
      for (const item of saveCandidates) {
        const parsed = item.parsed;
        if (!parsed || !item.rowId) continue;
        const resolution = resolutions[normalizedLabel(parsed.label)];
        if (!resolution) continue;
        await onUpdate(item.rowId, {
          [locationColumn.id]: serializeLocationCoordinate(
            parsed.label,
            resolution.coordinate,
          ),
        });
        saved += 1;
        setSavedRecordKeys((current) => {
          const next = new Set(current);
          next.add(item.key);
          return next;
        });
      }
      setSaveMessage(
        `${saved} ${saved === 1 ? "Record" : "Records"} updated with local coordinates.`,
      );
    } catch (error) {
      setSaveError(
        `${saved} ${saved === 1 ? "Record was" : "Records were"} saved before the update stopped. ${
          error instanceof Error ? error.message : "The coordinates could not be saved."
        }`,
      );
    } finally {
      setSaving(false);
    }
  }

  function flyTo(record: PlacedRecord) {
    setQuery(record.title);
    mapStateRef.current?.map.flyTo(
      [record.coordinate.latitude, record.coordinate.longitude],
      11,
      { duration: 1.1 },
    );
  }

  if (!locationColumn) {
    return (
      <div className="rounded-md border p-6 text-sm text-muted-foreground">
        Map requires a Location column.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search mapped Records"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear map search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-[1001] mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
              {suggestions.map((record) => (
                <div
                  key={record.key}
                  className="flex items-center gap-1 border-b last:border-b-0 hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => flyTo(record)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <MapPin size={13} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">
                      {record.title}
                    </span>
                    <span className="max-w-32 truncate text-xs text-muted-foreground">
                      {record.locationLabel}
                    </span>
                  </button>
                  {onOpenRecord && (
                    <button
                      type="button"
                      onClick={() => onOpenRecord(record.row)}
                      aria-label={`Open ${record.title}`}
                      className="mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <LocateFixed size={14} />
          {placed.length} of {parsedRows.length} plotted
        </div>
      </div>

      <div
        ref={mapElementRef}
        className="h-[420px] w-full sm:h-[500px]"
        aria-label={`Map of ${placed.length} Records`}
      />

      {placed.length > 0 && (
        <details className="border-t">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground">
            Browse mapped Records ({placed.length})
          </summary>
          <div
            role="list"
            aria-label="Mapped Records"
            className="max-h-56 divide-y overflow-y-auto border-t"
          >
            {placed.map((record) => (
              <div
                key={record.key}
                role="listitem"
                className="flex min-w-0 items-center gap-2 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => flyTo(record)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {record.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {record.locationLabel}
                  </span>
                </button>
                {onOpenRecord && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => onOpenRecord(record.row)}
                  >
                    Open
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="space-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {unresolvedLabels.length > 0 && (
            <>
              <span>
                {unresolvedLabels.length}{" "}
                {unresolvedLabels.length === 1 ? "place label needs" : "place labels need"}{" "}
                coordinates.
              </span>
              {geocoderStatus.loading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  Checking private geocoder
                </span>
              ) : geocoderStatus.available ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={resolving}
                  onClick={() => void resolveLocally()}
                >
                  {resolving ? (
                    <Loader2 size={12} className="mr-1 animate-spin" />
                  ) : (
                    <MapPin size={12} className="mr-1" />
                  )}
                  Resolve in Local Plane
                </Button>
              ) : geocoderStatus.error ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setStatusAttempt((value) => value + 1)}
                >
                  <RefreshCw size={12} className="mr-1" />
                  Retry provider check
                </Button>
              ) : (
                <span>
                  No private geocoder is configured. Enter{" "}
                  <code>Label | latitude, longitude</code> in the Location field.
                </span>
              )}
            </>
          )}

          {saveCandidates.length > 0 && onUpdate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => void saveResolvedCoordinates()}
            >
              {saving ? (
                <Loader2 size={12} className="mr-1 animate-spin" />
              ) : (
                <Save size={12} className="mr-1" />
              )}
              Save coordinates to {saveCandidates.length}{" "}
              {saveCandidates.length === 1 ? "Record" : "Records"}
            </Button>
          )}
        </div>

        <p>
          Place labels never go to a public geocoder or map-tile service.
          Resolution runs only after this button is pressed and only through an
          explicitly configured Local Plane provider.
          {geocoderStatus.attribution && (
            <>
              {" "}
              Provider data:{" "}
              <a
                href={geocoderStatus.attribution.url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {geocoderStatus.attribution.label}
              </a>
              .
            </>
          )}
        </p>

        {geocoderStatus.error && (
          <p role="alert" className="text-destructive">
            {geocoderStatus.error}
          </p>
        )}
        {resolutionError && (
          <p role="alert" className="text-destructive">
            {resolutionError}
          </p>
        )}
        {resolutionMessage && <p role="status">{resolutionMessage}</p>}
        {saveError && (
          <p role="alert" className="text-destructive">
            {saveError}
          </p>
        )}
        {saveMessage && <p role="status">{saveMessage}</p>}
      </div>
    </div>
  );
}
