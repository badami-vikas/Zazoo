import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { trpc } from "../../lib/trpc";
import { annotationSubjectFor, subjectKeyOf, type AnnotationSubject } from "./compose";

/**
 * Tags and Internal Notes, in the Chats header row next to "Sync messages".
 *
 * The user's complaint was the re-typing: the Tools Page panel makes you pick a
 * subject from a dropdown you have already picked on this page. So this control
 * has NO subject picker at all — it is scoped to whatever thread is selected,
 * and the subject key is derived from that thread by `annotationSubjectFor`,
 * the same derivation `AnnotationsPanel` uses. One data model, two doors.
 *
 * It reuses the existing `whatsapp.annotations` / `addTags` / `addNote` /
 * `removeTag` / `removeNote` procedures unchanged. Nothing here is forked and
 * nothing here is new persistence.
 *
 * A disclosure rather than a panel, because a header row is not a place for an
 * always-open form (UI architecture: Control-Panel-ish detail belongs behind a
 * menu, and the landing surface stays the data).
 *
 * These annotations are BRIDGE's own Local-Plane data. They declare no WhatsApp
 * permission, make no engine call, and are never sent to WhatsApp — so this
 * control works whether or not a session exists, and says so.
 */

const MUTED = { color: "var(--color-navy-mid)" } as const;
const BORDER = { borderColor: "var(--color-border)" } as const;
const DANGER = { color: "var(--color-danger, #b42318)" } as const;

type Annotations = Awaited<ReturnType<typeof trpc.whatsapp.annotations.query>>;
type SubjectAnnotations = Annotations["subjects"][number];

export interface ChatAnnotationsProps {
  /** The selected thread, or `null` when none is selected. */
  thread: { chatId: string; name?: string | undefined; isGroup?: boolean | undefined } | null;
}

export function ChatAnnotations({ thread }: ChatAnnotationsProps) {
  const [open, setOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotations | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject: AnnotationSubject | null = useMemo(
    () => annotationSubjectFor(thread),
    [thread],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setAnnotations(await trpc.whatsapp.annotations.query());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  // Loaded on mount so the header badge is truthful before anything is opened —
  // a count that only appears after you open the thing it is meant to advertise
  // is not a count.
  useEffect(() => {
    void load();
  }, [load]);

  // Drafts belong to the subject they were typed for.
  useEffect(() => {
    setTagDraft("");
    setNoteDraft("");
    setError(null);
  }, [subject?.id]);

  const current: SubjectAnnotations | null = useMemo(() => {
    if (!subject) return null;
    const key = subjectKeyOf(subject);
    return annotations?.subjects.find((entry) => entry.subjectKey === key) ?? null;
  }, [annotations, subject]);

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
    if (!subject) return;
    const tags = tagDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (tags.length === 0) return;
    await run(() => trpc.whatsapp.addTags.mutate({ kind: subject.kind, id: subject.id, tags }));
    setTagDraft("");
  }

  async function addNote() {
    if (!subject) return;
    const body = noteDraft.trim();
    if (body.length === 0) return;
    await run(() => trpc.whatsapp.addNote.mutate({ kind: subject.kind, id: subject.id, body }));
    setNoteDraft("");
  }

  const tagCount = current?.tags.length ?? 0;
  const noteCount = current?.notes.length ?? 0;
  const badge = subject && tagCount + noteCount > 0 ? ` (${tagCount + noteCount})` : "";

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((on) => !on)}>
        Tags &amp; notes{badge}
      </Button>

      {open ? (
        <div
          className="absolute right-0 z-20 mt-1 w-80 space-y-3 rounded-md border p-3 shadow-lg"
          style={{ ...BORDER, backgroundColor: "var(--color-surface, #ffffff)" }}
        >
          {!subject ? (
            // Explains rather than sitting inert: the control is reachable, and
            // it says what it needs instead of being a dead button.
            <p className="text-xs" style={MUTED}>
              Choose a conversation on the left. Tags and notes attach to the
              selected chat, so there is nothing to type a subject into.
            </p>
          ) : (
            <>
              <p className="truncate text-xs font-medium" style={{ color: "var(--color-navy)" }}>
                {subject.label}
              </p>

              <div className="space-y-1.5">
                <span className="text-xs font-medium" style={MUTED}>
                  Tags
                </span>
                {tagCount > 0 ? (
                  <ul className="flex flex-wrap gap-1">
                    {current?.tags.map((tag) => (
                      <li
                        key={tag}
                        className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                        style={BORDER}
                      >
                        <span>{tag}</span>
                        <button
                          type="button"
                          aria-label={`Remove tag ${tag}`}
                          disabled={busy}
                          style={MUTED}
                          onClick={() =>
                            void run(() =>
                              trpc.whatsapp.removeTag.mutate({
                                kind: subject.kind,
                                id: subject.id,
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
                  <p className="text-xs" style={MUTED}>
                    No tags on this chat yet.
                  </p>
                )}
                <div className="flex gap-2">
                  <Input
                    value={tagDraft}
                    placeholder="investor, warm lead"
                    disabled={busy}
                    aria-label="Add tags to this chat"
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addTags();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={busy || tagDraft.trim().length === 0}
                    onClick={() => void addTags()}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium" style={MUTED}>
                  Internal notes
                </span>
                {noteCount > 0 ? (
                  <ul className="max-h-40 space-y-2 overflow-auto">
                    {current?.notes.map((note) => (
                      <li key={note.id} className="rounded-md border p-2 text-xs" style={BORDER}>
                        <p className="whitespace-pre-wrap break-words">{note.body}</p>
                        <div className="mt-1 flex items-center justify-between" style={MUTED}>
                          <span>{new Date(note.createdAt).toLocaleString()}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                trpc.whatsapp.removeNote.mutate({
                                  kind: subject.kind,
                                  id: subject.id,
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
                  <p className="text-xs" style={MUTED}>
                    No notes on this chat yet.
                  </p>
                )}
                <textarea
                  className="w-full rounded-md border px-2 py-1 text-xs"
                  style={BORDER}
                  rows={3}
                  value={noteDraft}
                  disabled={busy}
                  aria-label="Write an internal note about this chat"
                  placeholder="What you want to remember about this thread."
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={busy || noteDraft.trim().length === 0}
                  onClick={() => void addNote()}
                >
                  Save note
                </Button>
              </div>

              <p className="text-xs" style={MUTED}>
                Tags and notes stay on this machine and are never sent to
                WhatsApp. Nobody in this chat can see them.
              </p>
            </>
          )}

          {error ? (
            <p className="text-xs" style={DANGER}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
