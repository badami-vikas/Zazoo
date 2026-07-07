// Bridge Tool manifest — the net-new "edge" surface from the Tool-internalization
// architecture (docs/raw/tools-internalization.md). The tool's UI/logic stay as-is;
// this manifest declares the three rebindable edges: model_bindings (plane), the
// typed output_contract (raw capture → Bridge entities), and intake_policy (gated).

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  source_repo: string;
  run_modes: Array<'standalone' | 'account_bound'>;
  model_bindings: Array<{ use: 'vision' | 'transcription' | 'llm'; plane_default: 'local' | 'cloud' }>;
  capabilities: Array<{ resourceType: string; action: string; dataScope: 'public' | 'private' | 'all'; egress: boolean }>;
  output_contract: Array<{ from: string; to: 'Person' | 'Memory' | 'Touchpoint' | 'Signal' | 'Initiative'; note?: string }>;
  intake_policy: { quarantine: boolean; commit_via: 'pipeline_proposal' };
}

export const CARD_SCANNER_MANIFEST: ToolManifest = {
  id: 'card-scanner',
  name: 'Card Scanner',
  version: '1.0.0',
  source_repo: 'Tools/card-scanner (internalized copy)',
  run_modes: ['standalone', 'account_bound'],
  // Capture plane = local by default (Ollama vision). Cloud (Groq/Gemini) = egress.
  model_bindings: [{ use: 'vision', plane_default: 'local' }],
  capabilities: [
    // The tool never writes the graph directly — it proposes through the pipeline.
    { resourceType: 'person', action: 'write', dataScope: 'public', egress: false },
    { resourceType: 'touchpoint', action: 'write', dataScope: 'public', egress: false },
  ],
  output_contract: [
    { from: 'card.name|role|company|email|phone|address|website', to: 'Person', note: 'canonical-tier facts' },
    { from: 'card capture event', to: 'Touchpoint', note: '"Met / scanned card" — the work node' },
  ],
  // Captures are quarantined and only enter the graph via a pipeline proposal on approval.
  intake_policy: { quarantine: true, commit_via: 'pipeline_proposal' },
};
