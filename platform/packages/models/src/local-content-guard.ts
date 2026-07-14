/**
 * createLocalContentGuard — LOCAL-plane adapter for the PI-3 dual-LLM
 * quarantine. The quarantine pattern keeps untrusted content (web pages,
 * inbound email, tool/MCP output, copied snippets) away from any privileged,
 * tool-capable model: a separate tool-less classifier/extractor sees the raw
 * content, emits only a typed ContentGuardVerdict, and the privileged path may
 * consume that bounded extraction rather than free-form instructions.
 *
 * Privacy constraint: this adapter is intentionally stricter than a generic
 * model binding. Private/untrusted content must be inspected by a LOCAL
 * classifier — never shipped to a SaaS/cloud detector. That mirrors the
 * capture/sensor-plane-local-models rule in CLAUDE.md: if the content came
 * from a private local surface, the detector stays local too. Passing a
 * cloud-plane ModelProvider fails at construction so callers cannot
 * accidentally route quarantined content through a remote service.
 */
import { QuarantinedContentGuard } from "@bridge/core";
import type { ContentGuard, ModelProvider } from "@bridge/core";

export class CloudContentGuardError extends Error {
  constructor(model: ModelProvider) {
    super(
      `createLocalContentGuard: model provider "${model.id}" is ${model.plane}-plane; ` +
        "private/untrusted content must be inspected by a LOCAL classifier and never shipped to a SaaS/cloud detector",
    );
    this.name = "CloudContentGuardError";
  }
}

export function createLocalContentGuard(model: ModelProvider): ContentGuard {
  if (model.plane !== "local") throw new CloudContentGuardError(model);
  return new QuarantinedContentGuard(model);
}
