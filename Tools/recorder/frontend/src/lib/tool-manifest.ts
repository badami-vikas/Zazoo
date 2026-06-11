// Bridge Tool manifest — the net-new "edge" surface (docs/raw/tools-internalization.md).
// Recorder is a PRIVATE, single-party capture tool: conversation transcripts are
// relationship-tier data, so captures are private and account-bound (never the anon
// public-intake path). Transcription + summarization default to LOCAL models.

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  source_repo: string;
  run_modes: Array<'standalone' | 'account_bound'>;
  model_bindings: Array<{ use: 'vision' | 'transcription' | 'llm'; plane_default: 'local' | 'cloud' }>;
  capabilities: Array<{ resourceType: string; action: string; dataScope: 'public' | 'private' | 'all'; egress: boolean }>;
  output_contract: Array<{ from: string; to: 'Person' | 'Memory' | 'Touchpoint' | 'Signal' | 'Initiative'; note?: string }>;
  intake_policy: { quarantine: boolean; commit_via: 'pipeline_proposal'; scope: 'private'; account_bound_only: boolean };
}

export const RECORDER_MANIFEST: ToolManifest = {
  id: 'recorder',
  name: 'Recorder',
  version: '1.0.0',
  source_repo: 'Tools/recorder (internalized copy)',
  // Single-party self-capture: account-bound only. No anonymous shared link for a
  // private conversation (private ∩ egress = none).
  run_modes: ['account_bound'],
  model_bindings: [
    { use: 'transcription', plane_default: 'local' }, // Whisper local
    { use: 'llm', plane_default: 'local' },           // Ollama local (summary + next steps)
  ],
  capabilities: [
    { resourceType: 'memory', action: 'write', dataScope: 'private', egress: false },
    { resourceType: 'touchpoint', action: 'write', dataScope: 'private', egress: false },
    { resourceType: 'initiative', action: 'write', dataScope: 'private', egress: false },
  ],
  output_contract: [
    { from: 'transcript + summary', to: 'Memory', note: 'the conversation, private tier' },
    { from: 'next_steps[{text,owner,due}]', to: 'Touchpoint', note: 'shape already matches the work node' },
    { from: 'project', to: 'Initiative', note: 'owns the touchpoints' },
  ],
  intake_policy: { quarantine: true, commit_via: 'pipeline_proposal', scope: 'private', account_bound_only: true },
};
