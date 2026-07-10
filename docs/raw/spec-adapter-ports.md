---
title: Adapter Port Specifications
type: raw
doc_kind: design
status: draft
companions: []
related_wiki: ../wiki/decisions.md
updated: 2026-07-09
tags: [adapters, ports, oss, document-provider, connector-provider]
---

# Adapter Port Specifications

Concrete port interface sketches for OSS-backed adapters adopted behind ports per ADR-035 (DocumentProvider)
and ADR-037 (ConnectorProvider). These are design-time contracts; implementations live in `packages/core/src/`
and individual adapter packages.

All ports follow the Bridge port/adapter pattern: callers depend only on the port interface; the adapter
wires the concrete implementation at startup via `wiring.ts`. The moat is the Capability Lifecycle and
governance engine — not any specific third-party implementation behind these ports.

---

## 1. DocumentProvider Port

**ADR:** ADR-035  
**Primary adapter:** DoclingAdapter (Docling — Apache 2.0)  
**Fallback adapter:** TikaAdapter (Apache Tika — Apache 2.0)  
**Location:** `packages/core/src/document/`

### Types

```typescript
/**
 * A single logical section within a parsed document.
 * Sections map to headings, table blocks, list blocks, etc.
 * depending on what the underlying parser can detect.
 */
export interface Section {
  /** Section heading text, if detectable. */
  heading?: string;
  /** Flat text content of this section. */
  text: string;
  /** Zero-based position in the document's section sequence. */
  index: number;
  /** Optional MIME-level type hint, e.g. "table" | "paragraph" | "list". */
  kind?: string;
}

/**
 * The structured result of parsing a document.
 * `text` = full document text (concatenation of all sections).
 * `sections` = logical subdivision for chunk-aware embedding.
 * `metadata` = format-specific extras (author, page count, language, etc.).
 */
export interface ParsedDocument {
  text: string;
  sections: Section[];
  metadata: Record<string, unknown>;
}
```

### Port Interface

```typescript
/**
 * DocumentProvider — port for document parsing.
 *
 * Implementations MUST:
 *   - Never send document bytes to an external network without an explicit
 *     External-band governance gate (local-first principle, ADR-010).
 *   - Return a ParsedDocument even on partial extraction; surface extraction
 *     warnings via the metadata field rather than throwing.
 *   - Be stateless: each `parse()` call is independent.
 */
export interface DocumentProvider {
  /**
   * Parse a document from a raw Buffer or a file:// URL.
   *
   * @param source  Raw bytes (Buffer) or a file:// URL pointing to the document.
   * @param mimeType  IANA media type, e.g. "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document".
   * @returns       Structured extraction result.
   */
  parse(source: Buffer | URL, mimeType: string): Promise<ParsedDocument>;
}
```

### DoclingAdapter (primary)

```typescript
/**
 * DoclingAdapter — wraps Docling's Python CLI or local HTTP server.
 *
 * Docling runs as a sidecar process (spawned by the API server at startup)
 * or as a Python subprocess per call. The adapter shells out to the Docling
 * CLI / HTTP endpoint; it never imports Docling's Python package directly
 * (Node.js boundary).
 *
 * Configuration (environment / capability manifest):
 *   DOCLING_MODE: "subprocess" | "http" (default: "subprocess")
 *   DOCLING_HTTP_URL: base URL when mode = "http" (default: "http://localhost:5001")
 *   DOCLING_TIMEOUT_MS: per-call timeout (default: 30_000)
 */
export class DoclingAdapter implements DocumentProvider {
  async parse(source: Buffer | URL, mimeType: string): Promise<ParsedDocument> {
    // subprocess mode: write source to tmp file, invoke `docling convert <path> --output json`
    // http mode:       POST to DOCLING_HTTP_URL/convert with multipart body
    // In both cases: parse JSON output → ParsedDocument shape.
    // On error: throw DocumentParseError with { mimeType, adapterName: "docling", cause }.
    throw new Error("DoclingAdapter.parse — implementation pending (P1)");
  }
}
```

### TikaAdapter (fallback)

```typescript
/**
 * TikaAdapter — wraps Apache Tika's server HTTP API.
 *
 * Tika runs as a local JVM server (`java -jar tika-server.jar`), spawned
 * by the API server or pre-started in Docker. The adapter POSTs document
 * bytes to the Tika /tika endpoint and receives plain text + metadata JSON.
 *
 * Configuration:
 *   TIKA_URL: base URL (default: "http://localhost:9998")
 *   TIKA_TIMEOUT_MS: per-call timeout (default: 20_000)
 *
 * Used as fallback when DoclingAdapter does not recognise the MIME type
 * or returns an error.
 */
export class TikaAdapter implements DocumentProvider {
  async parse(source: Buffer | URL, mimeType: string): Promise<ParsedDocument> {
    // POST source bytes to TIKA_URL/tika with Content-Type: mimeType
    // GET metadata from TIKA_URL/meta (JSON) for the same payload
    // Combine text + metadata into ParsedDocument.
    throw new Error("TikaAdapter.parse — implementation pending (P1)");
  }
}
```

### Wiring note

```typescript
// In packages/core/src/wiring.ts (or apps/api/src/wiring.ts):
//
// const documentProvider: DocumentProvider =
//   new FallbackDocumentProvider([
//     new DoclingAdapter(),   // primary
//     new TikaAdapter(),      // fallback on error or unknown MIME
//   ]);
//
// FallbackDocumentProvider tries adapters in order; on DocumentParseError
// it logs and tries the next. If all fail it throws AggregateDocumentParseError.
```

---

## 2. ConnectorProvider Port

**ADR:** ADR-037  
**Primary adapter:** NangoAdapter (Nango — Elastic License 2.0, **CONDITIONAL on license review**)  
**Fallback:** MinimalOAuthAdapter (in-house, in `@bridge/core`)  
**Location:** `packages/core/src/connector/`

> **IMPORTANT — license gate:** Do NOT merge a Nango npm dependency into `package.json` until the
> Elastic License 2.0 commercial-use review is complete and signed off. The MinimalOAuthAdapter is
> the unconditional fallback until that review resolves.

### Types

```typescript
/**
 * An OAuth 2.0 token bundle as returned by the connector provider.
 * Consumers should treat the token as opaque and never cache it beyond
 * the call boundary — always re-fetch from the port to benefit from
 * automatic refresh.
 */
export interface OAuthToken {
  accessToken: string;
  /** Unix epoch seconds, or undefined if the provider does not return expiry. */
  expiresAt?: number;
  /** Scopes granted, as reported by the OAuth server. */
  scopes: string[];
  /** Raw provider metadata for audit purposes. */
  raw: Record<string, unknown>;
}
```

### Port Interface

```typescript
/**
 * ConnectorProvider — port for OAuth token management.
 *
 * Implementations MUST:
 *   - Store tokens in the local plane only (no tokens cross the API boundary
 *     without explicit user consent + External-band governance gate).
 *   - Perform refresh transparently; callers never call refreshToken directly.
 *   - Throw ConnectorAuthError (with integrationId + workspaceId) on auth failure.
 */
export interface ConnectorProvider {
  /**
   * Retrieve a valid OAuth token for the given integration and workspace.
   * Performs a refresh automatically if the stored token is expired or near expiry.
   *
   * @param integrationId  The integration identifier, e.g. "gmail", "linear".
   * @param workspaceId    The workspace owning the credential.
   */
  getToken(integrationId: string, workspaceId: string): Promise<OAuthToken>;

  /**
   * Force a token refresh, bypassing the near-expiry heuristic.
   * Exposed for use by retry middleware after a 401 from the downstream API.
   */
  refreshToken(integrationId: string, workspaceId: string): Promise<OAuthToken>;

  /**
   * Revoke stored credentials for an integration + workspace pair.
   * Called on workspace disconnect or user-initiated de-auth.
   */
  revokeToken(integrationId: string, workspaceId: string): Promise<void>;
}
```

### NangoAdapter sketch (conditional — post license review)

```typescript
/**
 * NangoAdapter — wraps the Nango Node.js SDK.
 *
 * Nango manages token storage, refresh, and OAuth callback handling.
 * The adapter is a thin mapping layer: Nango connection IDs are keyed
 * as `${workspaceId}:${integrationId}` to preserve Bridge's tenancy model.
 *
 * Prerequisites:
 *   - Nango self-hosted (Docker) OR Nango Cloud (additional data-egress review).
 *   - Elastic License 2.0 commercial-use review signed off.
 *   - NANGO_SECRET_KEY + NANGO_BASE_URL env vars present.
 *
 * DO NOT instantiate this adapter until the license review is complete.
 */
export class NangoAdapter implements ConnectorProvider {
  async getToken(integrationId: string, workspaceId: string): Promise<OAuthToken> {
    // const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY });
    // const conn = await nango.getConnection(integrationId, `${workspaceId}:${integrationId}`);
    // return mapNangoConnectionToOAuthToken(conn);
    throw new Error("NangoAdapter — pending license review clearance");
  }

  async refreshToken(integrationId: string, workspaceId: string): Promise<OAuthToken> {
    throw new Error("NangoAdapter — pending license review clearance");
  }

  async revokeToken(integrationId: string, workspaceId: string): Promise<void> {
    throw new Error("NangoAdapter — pending license review clearance");
  }
}
```

### MinimalOAuthAdapter (unconditional fallback)

```typescript
/**
 * MinimalOAuthAdapter — in-house OAuth token store backed by the local DB.
 *
 * Stores encrypted access + refresh tokens in the `integrations` table
 * (already in the schema). Handles refresh via the provider's token endpoint
 * directly. No external service dependency.
 *
 * This is the unconditional fallback and the implementation that ships
 * before Nango license review is complete.
 */
export class MinimalOAuthAdapter implements ConnectorProvider {
  async getToken(integrationId: string, workspaceId: string): Promise<OAuthToken> {
    // 1. Load token row from integrations table for (workspaceId, integrationId).
    // 2. If expired (or within TOKEN_REFRESH_BUFFER_SECONDS of expiry), call refreshToken().
    // 3. Return OAuthToken from decrypted row.
    throw new Error("MinimalOAuthAdapter.getToken — implementation pending");
  }

  async refreshToken(integrationId: string, workspaceId: string): Promise<OAuthToken> {
    // 1. Load refresh_token from integrations table.
    // 2. POST to provider token endpoint with grant_type=refresh_token.
    // 3. Persist new token + expiry; return OAuthToken.
    throw new Error("MinimalOAuthAdapter.refreshToken — implementation pending");
  }

  async revokeToken(integrationId: string, workspaceId: string): Promise<void> {
    // 1. DELETE row from integrations table for (workspaceId, integrationId).
    // 2. Optionally POST to provider revocation endpoint if it exists.
    throw new Error("MinimalOAuthAdapter.revokeToken — implementation pending");
  }
}
```
