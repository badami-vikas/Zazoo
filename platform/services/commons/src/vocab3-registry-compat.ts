import { join } from "node:path";
import {
  adaptVocab2CommonsEntry,
  isVocab2CommonsEntry,
  type CommonsModuleEntry,
} from "@bridge/core";

export function priorRegistryRoot(dataDir: string): string {
  return join(dataDir, "packages");
}

export function decodeStoredCommonsEntry(raw: string): CommonsModuleEntry {
  const parsed: unknown = JSON.parse(raw);
  return isVocab2CommonsEntry(parsed)
    ? adaptVocab2CommonsEntry(parsed)
    : parsed as CommonsModuleEntry;
}
