import { parseModuleManifest } from "./manifest.js";
import { canonicalizeJson, type ManifestSignature } from "./signing.js";
import type {
  CommonsModuleEntry,
  CommonsProvenance,
  CommonsSecurityScan,
  CommonsSignedSource,
} from "./commons.js";
import type { CommonsModuleContent } from "./commons-trust.js";

type JsonObject = Record<string, unknown>;

const CONTENT_KEYS = new Set([
  "name",
  "version",
  "kind",
  "summary",
  "tags",
  "manifest",
  "provenance",
  "securityScan",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneObject(value: unknown, field: string): JsonObject {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  return structuredClone(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function canonicalKind(value: unknown): string {
  return value === "workspace_definition" ? "organization_definition" : requiredString(value, "kind");
}

function canonicalTerm(value: string): string {
  const lower = value.toLocaleLowerCase();
  if (lower === "workspace") return value === "Workspace" ? "Organization" : "organization";
  if (lower === "workspaces") return value === "Workspaces" ? "Organizations" : "organizations";
  if (lower === "package") return value === "Package" ? "Module" : "module";
  if (lower === "packages") return value === "Packages" ? "Modules" : "modules";
  if (["initiative", "project", "element"].includes(lower)) {
    return /^[A-Z]/.test(value) ? "Record" : "record";
  }
  if (["initiatives", "projects", "elements"].includes(lower)) {
    return /^[A-Z]/.test(value) ? "Records" : "records";
  }
  return value;
}

function adaptVocabularyMap(raw: unknown, field: string): Record<string, string> {
  const source = cloneObject(raw ?? {}, field);
  const adapted: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") throw new Error(`${field}.${key} must be a string`);
    const canonicalKey = canonicalTerm(key);
    if (adapted[canonicalKey] !== undefined && adapted[canonicalKey] !== value) {
      throw new Error(`${field} maps conflicting legacy terms to ${canonicalKey}`);
    }
    adapted[canonicalKey] = value;
  }
  return adapted;
}

function adaptManifest(raw: unknown) {
  const manifest = cloneObject(raw, "manifest");
  manifest.kind = canonicalKind(manifest.kind);

  const legacyVocab = manifest.workspaceVocab ?? manifest.workspace_vocab;
  if (legacyVocab !== undefined) {
    const vocab = cloneObject(legacyVocab, "manifest.workspaceVocab");
    const terms = vocab.domainTerms ?? vocab.domain_terms;
    manifest.organizationVocab = {
      alignsToBridgeTheme: vocab.alignsToBridgeTheme ?? vocab.aligns_to_bridge_theme ?? true,
      domainTerms: adaptVocabularyMap(terms, "manifest.workspaceVocab.domainTerms"),
    };
    delete manifest.workspaceVocab;
    delete manifest.workspace_vocab;
  }

  const capabilities = manifest.capabilities;
  if (Array.isArray(capabilities)) {
    manifest.capabilities = capabilities.map((rawCapability) => {
      const capability = cloneObject(rawCapability, "manifest.capabilities[]");
      if (Array.isArray(capability.permissions)) {
        capability.permissions = capability.permissions.map((rawPermission) => {
          const permission = cloneObject(rawPermission, "manifest.capabilities[].permissions[]");
          if (typeof permission.resourceType === "string") {
            permission.resourceType = canonicalTerm(permission.resourceType);
          }
          if (typeof permission.resource_type === "string") {
            permission.resource_type = canonicalTerm(permission.resource_type);
          }
          return permission;
        });
      }
      return capability;
    });
  }

  if (isObject(manifest.module) && Array.isArray(manifest.module.commonsNeeds)) {
    manifest.module.commonsNeeds = manifest.module.commonsNeeds.map((rawNeed) => {
      const need = cloneObject(rawNeed, "manifest.module.commonsNeeds[]");
      need.kind = canonicalKind(need.kind);
      return need;
    });
  }

  if (isObject(manifest.blueprint)) {
    const blueprint = manifest.blueprint;
    blueprint.vocabulary = adaptVocabularyMap(blueprint.vocabulary, "manifest.blueprint.vocabulary");
    if (Array.isArray(blueprint.entities)) {
      blueprint.entities = blueprint.entities.map((rawEntity) => {
        const entity = cloneObject(rawEntity, "manifest.blueprint.entities[]");
        if (typeof entity.nodeType === "string") entity.nodeType = canonicalTerm(entity.nodeType);
        if (Array.isArray(entity.fields)) {
          entity.fields = entity.fields.map((rawField) => {
            const field = cloneObject(rawField, "manifest.blueprint.entities[].fields[]");
            if (typeof field.relationTarget === "string") {
              field.relationTarget = canonicalTerm(field.relationTarget);
            }
            return field;
          });
        }
        return entity;
      });
    }
    if (Array.isArray(blueprint.views)) {
      blueprint.views = blueprint.views.map((rawView) => {
        const view = cloneObject(rawView, "manifest.blueprint.views[]");
        if (typeof view.entity === "string") view.entity = canonicalTerm(view.entity);
        return view;
      });
    }
  }

  return parseModuleManifest(manifest);
}

export interface AdaptedVocab2SignedContent {
  original: JsonObject;
  adapted: CommonsModuleContent;
}

export function readVocab2SignedContent(source: CommonsSignedSource): AdaptedVocab2SignedContent {
  if (
    (source.vocabularyVersion !== 2 && source.vocabularyVersion !== 3) ||
    typeof source.canonicalContent !== "string"
  ) {
    throw new Error("unsupported signed source");
  }
  const parsed: unknown = JSON.parse(source.canonicalContent);
  if (!isObject(parsed) || canonicalizeJson(parsed) !== source.canonicalContent) {
    throw new Error("signed source content is not canonical");
  }
  if (Object.keys(parsed).some((key) => !CONTENT_KEYS.has(key))) {
    throw new Error("signed source content has unknown fields");
  }

  const manifest = adaptManifest(parsed.manifest);
  const name = requiredString(parsed.name, "content.name");
  const version = requiredString(parsed.version, "content.version");
  const summary = requiredString(parsed.summary, "content.summary");
  const originalManifest = cloneObject(parsed.manifest, "content.manifest");
  if (
    originalManifest.name !== name ||
    originalManifest.version !== version ||
    originalManifest.kind !== parsed.kind ||
    originalManifest.summary !== summary
  ) {
    throw new Error("signed source metadata does not match its manifest");
  }
  if (!Array.isArray(parsed.tags) || parsed.tags.some((tag) => typeof tag !== "string")) {
    throw new Error("content.tags must be an array of strings");
  }

  const provenance = cloneObject(parsed.provenance, "content.provenance");
  if (
    Object.hasOwn(provenance, "artifactLicense") &&
    !Object.hasOwn(provenance, "contentLicense")
  ) {
    provenance.contentLicense = requiredString(
      provenance.artifactLicense,
      "content.provenance.artifactLicense",
    );
    delete provenance.artifactLicense;
  }
  return {
    original: parsed,
    adapted: {
      name,
      version,
      kind: manifest.kind,
      summary,
      tags: parsed.tags as string[],
      manifest,
      provenance: provenance as unknown as CommonsProvenance,
      securityScan: cloneObject(parsed.securityScan, "content.securityScan") as unknown as CommonsSecurityScan,
    },
  };
}

export function isVocab2CommonsEntry(raw: unknown): boolean {
  if (!isObject(raw) || !isObject(raw.manifest)) return false;
  return (
    raw.manifest.kind === "workspace_definition" ||
    Object.hasOwn(raw.manifest, "workspaceVocab") ||
    Object.hasOwn(raw.manifest, "workspace_vocab")
  );
}

export function adaptVocab2CommonsEntry(raw: unknown): CommonsModuleEntry {
  const envelope = cloneObject(raw, "entry");
  const content = Object.fromEntries(
    [...CONTENT_KEYS].map((key) => [key, envelope[key]]),
  );
  const source: CommonsSignedSource = {
    vocabularyVersion: 2,
    canonicalContent: canonicalizeJson(content),
  };
  const { adapted } = readVocab2SignedContent(source);
  const integrity = cloneObject(envelope.integrity, "entry.integrity") as unknown as CommonsModuleEntry["integrity"];
  const publishedAt = requiredString(envelope.publishedAt, "entry.publishedAt");
  const signature = envelope.signature === undefined
    ? undefined
    : cloneObject(envelope.signature, "entry.signature") as unknown as ManifestSignature;

  return {
    ...adapted,
    integrity,
    publishedAt,
    signedSource: source,
    ...(signature ? { signature } : {}),
  };
}

export function isVocab3CommonsEntry(raw: unknown): boolean {
  if (!isObject(raw) || !isObject(raw.provenance)) return false;
  return (
    Object.hasOwn(raw.provenance, "artifactLicense") &&
    !Object.hasOwn(raw.provenance, "contentLicense")
  );
}

export function adaptVocab3CommonsEntry(raw: unknown): CommonsModuleEntry {
  const envelope = cloneObject(raw, "entry");
  const content = Object.fromEntries(
    [...CONTENT_KEYS].map((key) => [key, envelope[key]]),
  );
  const source: CommonsSignedSource = {
    vocabularyVersion: 3,
    canonicalContent: canonicalizeJson(content),
  };
  const provenance = cloneObject(envelope.provenance, "entry.provenance");
  provenance.contentLicense = requiredString(
    provenance.artifactLicense,
    "entry.provenance.artifactLicense",
  );
  delete provenance.artifactLicense;
  return {
    ...envelope,
    provenance,
    signedSource: source,
  } as unknown as CommonsModuleEntry;
}
