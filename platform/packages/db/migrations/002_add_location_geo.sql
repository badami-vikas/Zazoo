-- Migration 002: add geocoded location columns to communities_canonical
-- Nominatim/Wikidata-resolved lat/lng + display name

ALTER TABLE communities_canonical
  ADD COLUMN IF NOT EXISTS headquarters_lat    double precision,
  ADD COLUMN IF NOT EXISTS headquarters_lng    double precision,
  ADD COLUMN IF NOT EXISTS location_display    text;

-- Spatial index for future proximity queries
CREATE INDEX IF NOT EXISTS communities_canonical_geo_idx
  ON communities_canonical (headquarters_lat, headquarters_lng)
  WHERE headquarters_lat IS NOT NULL;
