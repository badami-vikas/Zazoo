export const MEDIA_VOCAB2_COMPAT_SQL = `
UPDATE media_captures
SET provenance = (provenance - 'tool') || jsonb_build_object('skill', provenance->'tool')
WHERE provenance ? 'tool'
  AND NOT provenance ? 'skill';
`;
