/**
 * ModuleIntelligenceFields — one intelligence entry's fields, editable in place
 * (TASK-114, user directive 2026-09-11).
 *
 * WHAT CHANGED. An Agent, Skill, Automation or Integration used to render as
 * prose the reader could not touch. Now every field is a control: editing is
 * the default and a field that cannot be edited is the exception, disabled with
 * the reason printed beside it. The reason is not written here — it comes from
 * `moduleIntelligence.get`, which reads the same table the server refuses
 * writes with (ADR-247). This component cannot disagree with the server about
 * what is editable, because it does not know.
 *
 * NO EDIT MODE (user directive 2026-09-06, the Governance Section's rule). A
 * field saves when you leave it and the value actually changed; the component
 * then re-renders whatever the SERVER returned, never the input it was handed.
 * An empty required field is not sent — the row says it is unsaved rather than
 * claiming an edit that was refused.
 */
import { useCallback, useMemo, useState } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { trpc, PILOT_ORGANIZATION } from "../../lib/trpc";

export type IntelligenceView = Awaited<ReturnType<typeof trpc.moduleIntelligence.get.query>>;
export type IntelligenceEntry = IntelligenceView["entries"][number];

const inputStyle = {
  borderColor: "var(--color-border)",
  color: "var(--color-navy)",
  backgroundColor: "var(--color-background)",
} as const;

/**
 * A field's value as text.
 *
 * Locked fields carry whole objects — a Skill's permissions are
 * `{resourceType, action, dataScope, egress}` rows — and `String(...)` on one of
 * those renders "[object Object]", which tells the reader nothing about the
 * trust claim they are being shown. Each row is spelled out instead.
 */
const asText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).join(", ");
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.action === "string") {
      return [row.action, row.resourceType, row.dataScope, row.egress ? "egress" : null]
        .filter(Boolean)
        .join(" · ");
    }
    if (typeof row.id === "string") return row.id;
    return JSON.stringify(value);
  }
  return String(value);
};

export function ModuleIntelligenceFields({
  moduleName,
  entry,
  view,
  onChanged,
}: {
  moduleName: string;
  entry: IntelligenceEntry;
  view: IntelligenceView;
  onChanged: (next: IntelligenceView) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        onChanged(
          await trpc.moduleIntelligence.set.mutate({
            organizationId: PILOT_ORGANIZATION,
            moduleName,
            kind: entry.kind,
            entryId: entry.id,
            patch,
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSaving(false);
      }
    },
    [moduleName, entry.kind, entry.id, onChanged],
  );

  const reset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      onChanged(
        await trpc.moduleIntelligence.reset.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName,
          kind: entry.kind,
          entryId: entry.id,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [moduleName, entry.kind, entry.id, onChanged]);

  const lockedCount = useMemo(
    () => entry.fields.filter((field) => field.lockedReason).length,
    [entry.fields],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {entry.edited ? "Edited for this Organization" : "As the Module shipped it"}
          {lockedCount > 0 ? ` · ${lockedCount} fixed` : ""}
          {saving ? " · saving…" : ""}
        </p>
        {entry.edited && (
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            <RotateCcw className="size-3" />
            Reset
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="break-words rounded-md border border-red-200 p-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <dl className="divide-y rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
        {entry.fields.map((field) => (
          <div key={field.field} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
            <dt className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              {field.lockedReason && <Lock className="size-3 shrink-0" />}
              {field.label}
            </dt>
            <dd className="min-w-0">
              {/* Keyed on the SERVER's value: after a save or a reset the
                  control remounts on what came back, so a draft can never sit
                  on screen looking like the stored value. */}
              <FieldControl
                key={asText(field.value)}
                field={field}
                view={view}
                disabled={saving}
                onSave={(value) => save({ [field.field]: value })}
              />
              {field.lockedReason && (
                <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                  {field.lockedReason}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FieldControl({
  field,
  view,
  disabled,
  onSave,
}: {
  field: IntelligenceEntry["fields"][number];
  view: IntelligenceView;
  disabled: boolean;
  onSave: (value: unknown) => void;
}) {
  const locked = Boolean(field.lockedReason);
  const [draft, setDraft] = useState(() => asText(field.value));

  if (locked) {
    return (
      <p className="break-words text-sm" style={{ color: "var(--color-warm-gray)" }}>
        {asText(field.value) || "—"}
      </p>
    );
  }

  if (field.type === "skillRefs") {
    const selected = new Set(Array.isArray(field.value) ? (field.value as string[]) : []);
    if (view.skillOptions.length === 0) {
      return (
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          This Module ships no Skills to consume.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {view.skillOptions.map((option) => {
          const on = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = new Set(selected);
                if (on) next.delete(option.id);
                else next.add(option.id);
                onSave([...next]);
              }}
              className="rounded-full border px-2.5 py-1 text-xs"
              style={{
                borderColor: on ? "var(--color-steel)" : "var(--color-border)",
                color: on ? "var(--color-steel)" : "var(--color-warm-gray)",
              }}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    );
  }

  if (field.type === "agentRef") {
    return (
      <select
        value={asText(field.value)}
        disabled={disabled}
        onChange={(event) => onSave(event.target.value)}
        className="w-full rounded-md border px-2 py-1 text-sm"
        style={inputStyle}
      >
        {view.agentOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    if (field.type === "minutes") {
      const minutes = Number.parseInt(draft, 10);
      if (!Number.isInteger(minutes) || minutes < 1) return;
      if (minutes === field.value) return;
      onSave(minutes);
      return;
    }
    const trimmed = draft.trim();
    // Nothing on screen may claim an edit the server would refuse.
    if (trimmed.length === 0 || trimmed === asText(field.value)) return;
    onSave(trimmed);
  };

  if (field.type === "longtext") {
    return (
      <textarea
        value={draft}
        disabled={disabled}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="w-full rounded-md border px-2 py-1 text-sm"
        style={inputStyle}
      />
    );
  }

  return (
    <input
      type={field.type === "minutes" ? "number" : "text"}
      value={draft}
      disabled={disabled}
      min={field.type === "minutes" ? 1 : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-full rounded-md border px-2 py-1 text-sm"
      style={inputStyle}
    />
  );
}
