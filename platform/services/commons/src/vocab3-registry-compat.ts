import { join } from "node:path";
import {
  adaptVocab2CommonsEntry,
  adaptVocab3CommonsEntry,
  isVocab2CommonsEntry,
  isVocab3CommonsEntry,
  type CommonsModuleEntry,
} from "@bridge/core";

export function priorRegistryRoot(dataDir: string): string {
  return join(dataDir, "packages");
}

export function decodeStoredCommonsEntry(raw: string): CommonsModuleEntry {
  const parsed: unknown = JSON.parse(raw);
  if (isVocab2CommonsEntry(parsed)) return adaptVocab2CommonsEntry(parsed);
  if (isVocab3CommonsEntry(parsed)) return adaptVocab3CommonsEntry(parsed);
  return parsed as CommonsModuleEntry;
}
