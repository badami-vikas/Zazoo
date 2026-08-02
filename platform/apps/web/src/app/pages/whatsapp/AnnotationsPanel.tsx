import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { trpc } from "../../lib/trpc";

/**
 * The Tags and Internal Notes panel.
 *
 * Everything shown here is Bridge's own data, held on the Local Plane. The
 * panel makes no engine call at all — it never touches the WhatsApp session —
 * so unlike the Contact Extractor it works outside the desktop shell.
 *
 * The subject picker is populated from threads that have ACTUALLY been synced.
 * There is no free-text chat id field and no sample subject: annotating
 * something Bridge has never seen would create a note attached to an id the
 * rest of the Module cannot resolve, which reads as data loss later.
 */

type Annotations = Awaited<ReturnType<typeof trpc.whatsapp.annotations.query>>;
type SubjectAnnotations = Annotations["subjects"][number];
type Thread = Awaited<ReturnType<typeof trpc.whatsapp.syncState.query>>["threads"][number];

type SubjectKind = "chat" | "person" | "community";

interface Subject {
  kind: SubjectKind;
  id: string;
  label: string;
}

function subjectKeyOf(subject: { kind: string; id: string }): string {
  return `${subject.kind}:${subject.id}`;
}

export function AnnotationsPanel() {
  const [annotations, setAnnotations] = useState<Annotations | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [loadedAnnotations, syncState] = await Promise.all([
        trpc.whatsapp.annotations.query(),
        trpc.whatsapp.syncState.query(),
      ]);
      setAnnotations(loadedAnnotations);
      setThreads(syncState.threads);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Everything annotatable: synced threads, plus any subject that already
   * carries annotations. The second half matters after a re-sync — a thread
   * that dropped out of the sync state must not take its notes off-screen.
   */
  const subjects = useMemo<Subject[]>(() => {
    const byKey = new Map<string, Subject>();
    for (const thread of threads ?? []) {
      const kind: SubjectKind = thread.isGroup ? "community" : "chat";
      const subject = { kind, id: thread.chatId, label: thread.name || thread.chatId };
      byKey.set(subjectKeyOf(subject), subject);
    }
    for (const entry of annotations?.subjects ?? []) {
      if (!byKey.has(entry.subjectKey)) {
        byKey.set(entry.subjectKey, {
          kind: entry.kind as SubjectKind,
          id: entry.subjectId,
          label: entry.subjectId,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [threads, annotations]);

  const selected = useMemo(
    () => subjects.find((subject) => subjectKeyOf(subject) === selectedKey) ?? null,
    [subjects, selectedKey],
  );

  const current: SubjectAnnotations | null = useMemo(() => {
    if (!selectedKey) return null;
    return annotations?.subjects.find((entry) => entry.subjectKey === selectedKey) ?? null;
  }, [annotations, selectedKey]);

  async function run(action: () => Promise<Annotations>) {
    setBusy(true);
    setError(null);
    try {
      setAnnotations(await action());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addTags() {
    if (!selected) return;
    // One field, comma-separated — the tag vocabulary grows fastest when adding
    // several at once is not four round trips.
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (tags.length === 0) return;
    await run(() =>
      trpc.whatsapp.addTags.mutate({ kind: selected.kind, id: selected.id, tags }),
    );
    setTagDraft("");
  }

  async function addNote() {
    if (!selected) return;
    const body = noteDraft.trim();
    if (body.length === 0) return;
    await run(() =>
      trpc.whatsapp.addNote.mutate({ kind: selected.kind, id: selected.id, body }),
    );
    setNoteDraft("");
  }

  const muted = { color: "var(--color-navy-mid)" };
  const border = { borderColor: "var(--color-border)" };

  if (error && !annotations) {
    return (
      <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>
        {error}
      </p>
    );
  }

  if (!annotations) {
    return <p className="text-sm" style={muted}>Loading your tags and notes…</p>;
  }

  // Honest empty state: nothing to annotate and nothing annotated.
  if (subjects.length === 0) {
    return (
      <p className="text-sm" style={muted}>
        Nothing to annotate yet. Sync a chat on the Chats page first — tags and
        notes attach to threads Bridge has actually seen.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span style={muted}>Subject</span>
        <select
          className="w-full rounded-md border px-2 py-1 text-sm"
          style={border}
          value={selectedKey ?? ""}
          onChange={(event) => setSelectedKey(event.target.value || null)}
        >
          <option value="">Choose a chat, Person, or Community…</option>
          {subjects.map((subject) => {
            const key = subjectKeyOf(subject);
            const annotated = annotations.subjects.find((entry) => entry.subjectKey === key);
            const badge = annotated
              ? ` — ${annotated.tags.length} tag${annotated.tags.length === 1 ? "" : "s"}, ${annotated.notes.length} note${annotated.notes.length === 1 ? "" : "s"}`
              : "";
            return (
              <option key={key} value={key}>
                {subject.label}
                {badge}
              </option>
            );
          })}
        </select>
      </label>

      {selected ? (
        <div className="space-y-4 rounded-md border p-3" style={border}>
          <div className="space-y-2">
            <span className="text-xs font-medium" style={muted}>Tags</span>
            {current && current.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {current.tags.map((tag) => (
                  <li
                    key={tag}
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={border}
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      disabled={busy}
                      style={muted}
                      onClick={() =>
                        void run(() =>
                          trpc.whatsapp.removeTag.mutate({
                            kind: selected.kind,
                            id: selected.id,
                            tag,
                          }),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs" style={muted}>No tags on this subject yet.</p>
            )}
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                placeholder="investor, warm lead"
                disabled={busy}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTags();
                  }
                }}
              />
              <Button size="sm" disabled={busy || tagDraft.trim().length === 0} onClick={() => void addTags()}>
                Add
              </Button>
            </div>
            <p className="text-xs" style={muted}>
              Separate several with commas. Tags are lower-cased so casing never
              splits one tag into two.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium" style={muted}>Internal notes</span>
            {current && current.notes.length > 0 ? (
              <ul className="space-y-2">
                {current.notes.map((note) => (
                  <li key={note.id} className="rounded-md border p-2 text-sm" style={border}>
                    <p className="whitespace-pre-wrap">{note.body}</p>
                    <div className="mt-1 flex items-center justify-between text-xs" style={muted}>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            trpc.whatsapp.removeNote.mutate({
                              kind: selected.kind,
                              id: selected.id,
                              noteId: note.id,
                            }),
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs" style={muted}>No notes on this subject yet.</p>
            )}
            <textarea
              className="w-full rounded-md border px-2 py-1 text-sm"
              style={border}
              rows={3}
              value={noteDraft}
              disabled={busy}
              placeholder="What you want to remember about this thread."
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            <Button size="sm" disabled={busy || noteDraft.trim().length === 0} onClick={() => void addNote()}>
              Save note
            </Button>
            <p className="text-xs" style={muted}>
              Notes stay on this machine and are never sent to WhatsApp. Nobody
              you message can see them.
            </p>
          </div>
        </div>
      ) : null}

      {annotations.tags.length > 0 ? (
        <div className="space-y-1">
          <span className="text-xs font-medium" style={muted}>Tags in use</span>
          <ul className="flex flex-wrap gap-1">
            {annotations.tags.map((entry) => (
              <li key={entry.tag} className="rounded-full border px-2 py-0.5 text-xs" style={border}>
                {entry.tag} · {entry.subjects}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}
    </div>
  );
}
