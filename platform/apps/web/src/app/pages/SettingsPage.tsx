/**
 * Settings — one of the six permanent shell chrome containers (ADR-023 item
 * 1: bottom bar "Intelligence · KnowledgeBase · Settings"). No backend
 * settings/preferences router exists yet in apps/api (grep-confirmed: no
 * `settings.*`/`preferences.*` procedures on appRouter) — this renders an
 * honest placeholder rather than fabricated toggles/forms wired to nothing.
 * Workspace-identifying info that IS real (the pilot workspace id) is shown
 * since it costs nothing to be honest about.
 */
import { PILOT_WORKSPACE } from "../lib/trpc";

export function SettingsPage() {
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-xl">
      <h1 className="text-lg font-medium">Settings</h1>
      <div className="border rounded-md p-4 text-sm text-muted-foreground space-y-2">
        <div>No settings/preferences backend exists yet — this page is a placeholder chrome container.</div>
        <div>
          Workspace: <code className="px-1 py-0.5 rounded bg-muted">{PILOT_WORKSPACE}</code>
        </div>
      </div>
    </div>
  );
}
