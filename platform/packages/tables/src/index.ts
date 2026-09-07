export type {
  ColumnKind,
  ColumnSpec,
  TableSpec,
  FilterOp,
  RowFilter,
  SortSpec,
  ViewKind,
  GraphScope,
  ViewConfig,
  ColumnOverlay,
  MetadataColumnKind,
} from "./types.js";
export {
  VIEW_KINDS,
  METADATA_COLUMN_KINDS,
  // The filter grammar (Notion parity 2026-09-06) was declared in types.ts and
  // never exported, so the only surface that could have used it — the Filter
  // popover — went on shipping one hardcoded `contains` (TASK-110).
  FILTER_OP_LABELS,
  VALUELESS_FILTER_OPS,
  filterOpsForKind,
  defaultViewConfig,
  isMetadataColumn,
  normalizeViewKind,
  applyColumnOverlay,
} from "./types.js";
export type { PersistencePort } from "./persistence-port.js";
export { createLocalStoragePort, createMemoryPort } from "./persistence-port.js";
export { applyFilters, applySorts, groupBy } from "./engine.js";
export type {
  GeoCoordinate,
  ParsedLocationValue,
  ResolvedLocationCoordinate,
  LocationResolutionResult,
  LocationResolutionBatchOptions,
} from "./location.js";
export {
  formatLocationInput,
  parseLocationValue,
  resolveLocationLabelsInBatches,
  serializeLocationCoordinate,
} from "./location.js";
