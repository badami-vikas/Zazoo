// Lazy-loaded — Leaflet only initialises when Map view is selected.
import { useEffect, useRef, useMemo, useState } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router';

interface LatLng { lat: number; lng: number }
interface Placed { id: string; name: string; location?: string; coords: LatLng }

// ── geocoding helpers ──────────────────────────────────────────────────────
const CACHE_KEY = 'bridge_geo_v3';
const loadCache = (): Record<string, LatLng | null> => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
};
const saveCache = (c: Record<string, LatLng | null>) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
};
const geocodeOne = async (q: string): Promise<LatLng | null> => {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    const d = await r.json();
    if (d?.[0]) return { lat: +d[0].lat, lng: +d[0].lon };
  } catch {}
  return null;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── grid clustering ────────────────────────────────────────────────────────
// Groups placed people into grid cells sized by zoom level.
// Cells with ≥ CLUSTER_MIN become a numbered circle; smaller groups stay as pins.
const CLUSTER_MIN = 10;

function clusterPlaced(placed: Placed[], zoom: number) {
  // Cell size in degrees — halves every zoom step.
  const cell = 360 / Math.pow(2, Math.max(1, zoom));
  const grid = new Map<string, Placed[]>();
  for (const p of placed) {
    const k = `${Math.floor(p.coords.lat / cell)},${Math.floor(p.coords.lng / cell)}`;
    const g = grid.get(k);
    g ? g.push(p) : grid.set(k, [p]);
  }
  const clusters: { lat: number; lng: number; count: number; bounds: [[number,number],[number,number]] }[] = [];
  const singles: Placed[] = [];
  for (const group of grid.values()) {
    if (group.length >= CLUSTER_MIN) {
      const lats = group.map(p => p.coords.lat);
      const lngs = group.map(p => p.coords.lng);
      clusters.push({
        lat: lats.reduce((a, b) => a + b) / lats.length,
        lng: lngs.reduce((a, b) => a + b) / lngs.length,
        count: group.length,
        bounds: [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      });
    } else {
      singles.push(...group);
    }
  }
  return { clusters, singles };
}

// ── component ──────────────────────────────────────────────────────────────
export function PeopleMapView({ rows }: { rows: { id: string; name: string; location?: string }[] }) {
  const navigate   = useNavigate();
  const mapDivRef  = useRef<HTMLDivElement>(null);
  const stateRef   = useRef<{ map: any; L: any; clusterLayer: any; pinLayer: any } | null>(null);

  // geocoding state
  const [geoMap, setGeoMap]       = useState<Record<string, LatLng | null>>({});
  const [geocoding, setGeocoding] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [totalUniq, setTotalUniq] = useState(0);
  const abortRef = useRef(false);

  const uniqueLocs = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => { const l = (r.location || '').trim(); if (l) s.add(l); });
    return [...s];
  }, [rows]);

  useEffect(() => {
    abortRef.current = false;
    const cache = loadCache();
    const missing = uniqueLocs.filter(l => !(l in cache));
    const already = uniqueLocs.length - missing.length;
    setTotalUniq(uniqueLocs.length);
    setDoneCount(already);
    setGeoMap({ ...cache });
    if (!missing.length) return;
    setGeocoding(true);
    let done = 0;
    (async () => {
      for (const loc of missing) {
        if (abortRef.current) break;
        cache[loc] = await geocodeOne(loc);
        done++;
        setDoneCount(already + done);
        setGeoMap({ ...cache });
        if (done % 20 === 0) saveCache(cache);
        await sleep(1050);
      }
      saveCache(cache);
      setGeocoding(false);
    })();
    return () => { abortRef.current = true; };
  }, [uniqueLocs]);

  const placed = useMemo<Placed[]>(() =>
    rows
      .filter(r => r.location && geoMap[(r.location || '').trim()])
      .map(r => ({ ...r, coords: geoMap[(r.location || '').trim()]! })),
    [rows, geoMap],
  );

  // ── Leaflet init (once) ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current) return;
    let dead = false;

    (async () => {
      const [{ default: L }] = await Promise.all([
        import('leaflet'),
        import('leaflet/dist/leaflet.css' as any),
      ]);
      if (dead || !mapDivRef.current) return;

      // fix bundler marker icon paths
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const map = L.map(mapDivRef.current!, { preferCanvas: true, zoomControl: true }).setView([20, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const clusterLayer = L.layerGroup().addTo(map);
      const pinLayer     = L.layerGroup().addTo(map);
      stateRef.current   = { map, L, clusterLayer, pinLayer };

      // Re-render markers on zoom.
      map.on('zoomend', () => {
        const s = stateRef.current;
        if (s) renderMarkers(s.L, s.map, s.clusterLayer, s.pinLayer);
      });
    })();

    return () => {
      dead = true;
      if (stateRef.current) { stateRef.current.map.remove(); stateRef.current = null; }
    };
  }, []);

  // Re-render whenever placed[] changes.
  const placedRef = useRef<Placed[]>([]);
  placedRef.current = placed;

  function renderMarkers(L: any, map: any, clusterLayer: any, pinLayer: any) {
    clusterLayer.clearLayers();
    pinLayer.clearLayers();
    const zoom = map.getZoom();
    const { clusters, singles } = clusterPlaced(placedRef.current, zoom);

    // Cluster circles
    clusters.forEach(c => {
      const size = c.count > 999 ? 56 : c.count > 99 ? 48 : 40;
      const icon = L.divIcon({
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:rgba(77,126,168,0.85);
          border:3px solid rgba(77,126,168,0.3);
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:700;font-size:${c.count>99?11:13}px;
          font-family:system-ui,sans-serif;
          box-shadow:0 2px 8px rgba(0,0,0,.18);
          cursor:pointer;
        ">${c.count > 999 ? '999+' : c.count}</div>`,
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([c.lat, c.lng], { icon });
      marker.on('click', () => {
        map.fitBounds(c.bounds, { padding: [60, 60], maxZoom: zoom + 3 });
      });
      clusterLayer.addLayer(marker);
    });

    // Individual pins
    singles.forEach(r => {
      const marker = L.marker([r.coords.lat, r.coords.lng]);
      marker.bindPopup(
        `<div style="font-family:system-ui,sans-serif;min-width:150px;padding:2px 0">
          <div style="font-weight:700;font-size:13px;color:#1A2B3C;margin-bottom:2px">${r.name.replace(/</g, '&lt;')}</div>
          <div style="font-size:11px;color:#6B6860;margin-bottom:8px">${(r.location || '').replace(/</g, '&lt;')}</div>
          <button data-nav="${encodeURIComponent(r.name)}" style="font-size:11px;color:#4D7EA8;font-weight:600;background:none;border:none;padding:0;cursor:pointer">View profile →</button>
        </div>`,
        { maxWidth: 240 },
      );
      pinLayer.addLayer(marker);
    });
  }

  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    renderMarkers(s.L, s.map, s.clusterLayer, s.pinLayer);
  }, [placed]);

  // popup "View profile" delegation
  useEffect(() => {
    const el = mapDivRef.current;
    if (!el) return;
    const h = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
      if (btn) navigate(`/item/${decodeURIComponent(btn.getAttribute('data-nav') || '')}`);
    };
    el.addEventListener('click', h);
    return () => el.removeEventListener('click', h);
  }, [navigate]);

  // search
  const [query, setQuery]         = useState('');
  const [flyTarget, setFlyTarget] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!flyTarget || !stateRef.current) return;
    stateRef.current.map.flyTo([flyTarget.lat, flyTarget.lng], 12, { duration: 1.2 });
  }, [flyTarget]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return placed.filter(r => r.name.toLowerCase().includes(q)).slice(0, 12);
  }, [placed, query]);

  const pct = totalUniq > 0 ? Math.round((doneCount / totalUniq) * 100) : 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ position: 'relative', zIndex: 1000, background: 'white', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-warm-gray)', pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setFlyTarget(null); }}
            placeholder="Search people on map…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: query ? 28 : 10, paddingTop: 6, paddingBottom: 6, fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none', color: 'var(--color-navy)', boxSizing: 'border-box' }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setFlyTarget(null); }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={14} color="var(--color-warm-gray)" />
            </button>
          )}
          {query && suggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.10)', overflow: 'hidden', zIndex: 9999 }}>
              {suggestions.map(r => (
                <button key={r.id} onClick={() => { setFlyTarget(r.coords); setQuery(r.name); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--color-navy)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <MapPin size={13} style={{ color: 'var(--color-steel)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-warm-gray)', flexShrink: 0 }}>{r.location}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-warm-gray)' }}>
          {geocoding
            ? <><Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-steel)' }} /> Geocoding… {pct}%</>
            : <><MapPin size={13} style={{ color: 'var(--color-steel)' }} /> {placed.length.toLocaleString()} people mapped</>}
        </div>
      </div>

      {/* Map */}
      <div ref={mapDivRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
