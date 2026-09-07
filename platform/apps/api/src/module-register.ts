import { TRPCError } from "@trpc/server";
import { load as loadYaml, YAMLException } from "js-yaml";
import {
  ModuleManifestValidationError,
  parseModuleManifest,
  type ModuleInstallationRow,
  type ModuleManifest,
} from "@bridge/core";
import { readModuleFileContent } from "./module-files.js";
import { unknownRelationTargets } from "./table-schema.js";
import type { Wiring } from "./wiring.js";

/** The one file that makes a folder a Module. */
export const MODULE_MANIFEST_FILE = "module.yaml";

/**
 * Register a manifest as a PRIVATE, pending-review installation — the first
 * governed step of every Module's life, whether it arrived from Commons, from
 * `modules.register`, or from a Builder Run's `module.yaml`. Install stays a
 * separate proposal through the pipeline (`modules.install`); nothing here
 * grants a capability.
 */
export async function registerModuleManifest(
  wiring: Pick<Wiring, "moduleStore">,
  organizationId: string,
  raw: unknown,
): Promise<ModuleInstallationRow> {
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleManifest(raw);
  } catch (err) {
    if (err instanceof ModuleManifestValidationError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }
  // A relation to a Database nobody declares (TASK-108). The same-manifest half
  // is a parse error; this half needs the Modules already here, which is why it
  // is asked at registration and not inside the parser.
  const { items } = await wiring.moduleStore.list(organizationId, { limit: 500, offset: 0 });
  const missing = unknownRelationTargets(manifest, items);
  if (missing.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${manifest.name} relates to ${missing.join(", ")}, and no installed Module has a Database by that name`,
    });
  }
  return wiring.moduleStore.create({
    organizationId,
    moduleName: manifest.name,
    moduleVersion: manifest.version,
    manifest,
    computedRisk: "informational", // not yet computed — install() computes it
    state: "private",
    status: "pending_review",
    lineageManifestId: manifest.lineageManifestId,
  });
}

/**
 * Read a Module folder's `module.yaml` (ADR 2026-09-04). Null when the folder
 * has none — a Builder Run that has not reached step 1 yet is not an error.
 * A file that is not valid YAML, or a YAML document whose `module.name` is
 * not this folder's name, IS: the folder and the manifest must agree, or the
 * Files root and the installation would name two different Modules.
 */
export async function readModuleManifestFile(
  wiring: Pick<Wiring, "moduleFilesBridgeRoot">,
  organizationName: string,
  moduleName: string,
): Promise<unknown | null> {
  const file = await readModuleFileContent(
    organizationName,
    moduleName,
    MODULE_MANIFEST_FILE,
    wiring.moduleFilesBridgeRoot,
  );
  if (!file) return null;
  let parsed: unknown;
  try {
    parsed = loadYaml(Buffer.from(file.content).toString("utf8"), { filename: MODULE_MANIFEST_FILE });
  } catch (err) {
    if (err instanceof YAMLException) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${MODULE_MANIFEST_FILE}: ${err.message}` });
    }
    throw err;
  }
  const declared = (parsed as { module?: { name?: unknown } } | null)?.module?.name;
  if (declared !== moduleName) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${MODULE_MANIFEST_FILE} names module ${String(declared)}, but the folder is ${moduleName}`,
    });
  }
  return parsed;
}
