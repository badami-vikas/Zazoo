/**
 * CompanionComposer — the companion's ONE chat input.
 *
 * Both of the avatar's homes used to grow their own: NotchHome carried a
 * dark three-line textarea beside Zazoo, and the free-floating overlay a
 * light single-line `<input>` in its hover bar. Two implementations of the
 * same act ("say something to the companion") drifted in the ways duplicates
 * always do — Shift+Enter made a newline in one and nothing in the other,
 * Escape meant different things, and the placeholder was the only thing they
 * agreed on (user report 2026-08-16: "there are 3 different chat interfaces
 * in avatar").
 *
 * There is now one composer with one behaviour, skinned per home, and it is
 * an ENTRY AFFORDANCE, not a chat: submitting hands the text to the shared
 * `ChatView` (surface `avatar_overlay`), which is the same server thread the
 * app's side panel and the Chief of Staff Page render. Nothing here talks to
 * a model.
 *
 * The companion's screen-aware mode (`CompanionAsk`) is deliberately NOT this
 * — it is a different capability on a different pipeline, reached from the
 * right-click menu and ⌘⇧Space, and it no longer presents itself as chat.
 */
import { useEffect, useRef, useState } from "react";

export type CompanionComposerVariant = "notch" | "hover";

export function CompanionComposer({
  name,
  variant,
  focused = false,
  onSubmit,
  onFocus,
  onDismiss,
}: {
  name: string;
  /** Which home is rendering this — skin only; behaviour is identical. */
  variant: CompanionComposerVariant;
  /** Rising edge moves keyboard focus here (the notch does this when its
   * composer pose opens). */
  focused?: boolean;
  /** Called with the trimmed text; the caller opens the chat panel with it. */
  onSubmit: (text: string) => void;
  onFocus?: () => void;
  /** Escape, and the × button when supplied. */
  onDismiss?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSubmit(text);
  }

  const notch = variant === "notch";

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        ref={inputRef}
        // One line in the hover bar (it sits above a 96px avatar), three in
        // the notch panel (user directive: enough to see a whole thought).
        rows={notch ? 3 : 1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        // Focus was a one-way door: the notch sets pose="chat" on focus, and
        // pose "chat" pins the overlay open, so once you clicked the composer
        // the companion never concealed again however far the cursor went
        // (user report 2026-08-17). Blurring an EMPTY composer releases that
        // pin; a draft in progress still holds the window open, because
        // vanishing mid-sentence would be the worse bug.
        onBlur={() => { if (!draft.trim()) onDismiss?.(); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
            return;
          }
          if (event.key === "Escape") {
            setDraft("");
            onDismiss?.();
          }
        }}
        placeholder={`Message ${name}…`}
        aria-label={`Message ${name}`}
        style={
          notch
            ? {
                width: "100%",
                resize: "none",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.10)",
                color: "#fff",
                fontSize: 12,
                lineHeight: "16px",
                fontFamily: "inherit",
                padding: "8px 12px",
                outline: "none",
              }
            : { resize: "none", overflow: "hidden" }
        }
        className={
          notch
            ? undefined
            : "w-full rounded-[var(--radius-button)] border border-border bg-background shadow-md text-sm px-2 py-1.5 pr-7 focus:outline-none focus-visible:ring-2"
        }
      />
      {onDismiss && !notch && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            setDraft("");
            onDismiss();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground leading-none"
          style={{ fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
