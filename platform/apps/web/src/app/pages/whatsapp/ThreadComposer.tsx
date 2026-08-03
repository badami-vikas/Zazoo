import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { whatsAppEngine, type SendCeilingStatus } from "./engine";
import {
  describeSendFailure,
  describeSendOutcome,
  manualSendRequest,
  type OutcomeNotice,
} from "./compose";

/**
 * The compose box on the Chats surface — a person writing one message into the
 * conversation they are looking at (ADR-160).
 *
 * It is a thin shell over `whatsAppEngine.sendManualMessage`. Every decision
 * about whether the message may go lives behind that call, and the last word
 * belongs to the durable Rust ceiling; this component's whole job is to name
 * the answer honestly.
 *
 * Three states the user must always be able to tell apart, and they are visibly
 * different here:
 *
 *   - **Sent.**
 *   - **Refused, and why** — the cap is full until a time, sending is halted and
 *     a person must re-arm it, the message is too long. The draft is KEPT so a
 *     refusal never costs the user their words.
 *   - **We don't know** — the ceiling admitted the send and something went wrong
 *     afterwards. Rendered as its own state, because telling a user "not sent"
 *     when it may have been sent makes them send it twice.
 *
 * Nothing here is a silent no-op and nothing here throws into the void: the send
 * call returns outcomes as values, and the one `catch` still produces a
 * sentence.
 */

const MUTED = { color: "var(--color-navy-mid)" } as const;
const BORDER = { borderColor: "var(--color-border)" } as const;

const TONE_COLOUR: Record<OutcomeNotice["tone"], string> = {
  sent: "var(--color-navy-mid)",
  refused: "var(--color-danger, #b42318)",
  deferred: "var(--color-danger, #b42318)",
  unknown: "var(--color-danger, #b42318)",
};

export interface ThreadComposerProps {
  chatId: string;
  isGroup?: boolean | undefined;
  threadName?: string | undefined;
  /** Whether the device is linked. Unknown (`null`) is not treated as "no". */
  linked: boolean | null;
  /** Called after a message actually went, so the thread can be re-read. */
  onSent: () => void;
}

/** How the shared ceiling currently stands, said in plain words. */
function ceilingLine(ceiling: SendCeilingStatus | undefined): string | null {
  if (!ceiling) return null;
  if (ceiling.killSwitch.status === "halted") {
    const reason = ceiling.killSwitch.reason?.trim();
    return reason
      ? `Sending is halted (${reason}). Someone has to re-arm it before Bridge will send anything.`
      : "Sending is halted. Someone has to re-arm it before Bridge will send anything.";
  }
  return `${ceiling.sentLast24h} of ${ceiling.effectiveDailyCap} sends used in the last 24 hours.`;
}

export function ThreadComposer({
  chatId,
  isGroup,
  threadName,
  linked,
  onSent,
}: ThreadComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<OutcomeNotice | null>(null);
  const [ceiling, setCeiling] = useState<SendCeilingStatus | undefined>(undefined);
  const live = useRef(true);

  const refreshCeiling = useCallback(async () => {
    const status = await whatsAppEngine.sendCeiling();
    if (live.current) setCeiling(status);
  }, []);

  useEffect(() => {
    live.current = true;
    void refreshCeiling();
    return () => {
      live.current = false;
    };
  }, [refreshCeiling]);

  // A new conversation starts with a clean slate: last message's outcome
  // belongs to the thread it happened in.
  useEffect(() => {
    setNotice(null);
    setBody("");
  }, [chatId]);

  async function send() {
    if (sending) return;
    const built = manualSendRequest({ chatId, isGroup }, body);
    if ("refusal" in built) {
      setNotice({ tone: "refused", text: `Not sent — ${built.refusal}` });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const outcome = await whatsAppEngine.sendManualMessage(built.request);
      if (!live.current) return;
      const described = describeSendOutcome(outcome);
      setNotice(described);
      if (described.tone === "sent") {
        // Only a confirmed send clears the draft. A refusal that ate the user's
        // words would be worse than the refusal.
        setBody("");
        onSent();
      }
    } catch (failure) {
      if (live.current) setNotice(describeSendFailure(failure));
    } finally {
      if (live.current) {
        setSending(false);
        void refreshCeiling();
      }
    }
  }

  const halted = ceiling?.killSwitch.status === "halted";
  // An unknown link state is NOT a "no". A failed status probe means the probe
  // failed, and blocking the compose box on it would repeat the mistake that
  // once made a live session announce it was unlinked.
  const notLinked = linked === false;
  const blocked = notLinked || halted;
  const status = ceilingLine(ceiling);

  return (
    <div className="border-t p-2" style={BORDER}>
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-[38px] w-full resize-y rounded-md border px-2 py-1.5 text-sm"
          style={BORDER}
          rows={1}
          value={body}
          disabled={sending || blocked}
          aria-label={`Message ${threadName?.trim() || chatId}`}
          placeholder={
            notLinked
              ? "Link this device before sending"
              : halted
                ? "Sending is halted"
                : "Write a message"
          }
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line — what WhatsApp does,
            // so muscle memory does not send a half-written message.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          size="sm"
          disabled={sending || blocked || body.trim().length === 0}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      {notice ? (
        <p className="mt-1.5 text-xs" style={{ color: TONE_COLOUR[notice.tone] }} role="status">
          {notice.text}
        </p>
      ) : null}

      {status ? (
        <p className="mt-1 text-xs" style={MUTED}>
          {status}
          {!halted ? (
            <>
              {" "}
              Bridge counts manual and automated messages against one durable
              limit, so a cap or cooldown refusal here is the same protection an
              Agent gets.
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
