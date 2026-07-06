/**
 * @bridge/sensors — the Sensor SPI (context-provider registry). Kernel-side
 * contract ONLY: the Tauri desktop shell's Rust capture core implements the
 * desktop provider subset against this interface; the kernel runs with zero
 * providers (sensing is an optional capability, never a kernel dependency).
 */
export {
  SURFACE_PROVIDER_KINDS,
  type CaptureEmission,
  type ContextObservation,
  type ContextProvider,
  type ContextProviderKind,
  type RawCapture,
  type Sensor,
  type SensorObservation,
  type Surface,
} from "./types.js";
export {
  InMemoryCaptureLedger,
  type CaptureLedger,
  type MemoryEntryRecord,
} from "./capture-ledger.js";
export { SensorHub, permissionsForKind, type ContextConsumer, type SensorHubDeps } from "./hub.js";
export { FakeContextProvider } from "./fake-provider.js";
