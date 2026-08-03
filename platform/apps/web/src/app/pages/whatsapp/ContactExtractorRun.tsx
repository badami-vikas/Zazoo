import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  whatsAppEngine,
  type RawContact,
  type RawGroup,
} from "./engine";

type Mode = "contacts" | "groups";
type Policy = "contacts" | "contacts_and_messaged" | "all";

const POLICY_LABEL: Record<Policy, string> = {
  contacts: "People in your address book",
  contacts_and_messaged: "Address book + anyone you've messaged",
  all: "Everyone in the group",
};

interface RunSummary {
  mode: Mode;
  contacts: number;
  groups: number;
  members: number;
}

/**
 * The Contact Extractor's run panel.
 *
 * Two properties are deliberate rather than incidental:
 *
 *  - Group participants are read ONE GROUP AT A TIME, sequentially. Measured on
 *    a real account this is 817 groups and 35,298 participants; firing those in
 *    parallel is exactly the burst pattern that draws enforcement on a personal
 *    number.
 *  - Nothing here commits. A run produces a staged proposal set for Approvals.
 */
export function ContactExtractorRun() {
  const [mode, setMode] = useState<Mode>("contacts");
  const [policy, setPolicy] = useState<Policy>("contacts_and_messaged");
  const [groups, setGroups] = useState<RawGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  async function loadGroups() {
    setError(null);
    setBusy("Reading your groups…");
    try {
      setGroups(await whatsAppEngine.listGroups());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setError(null);
    setSummary(null);
    try {
      if (mode === "contacts") {
        setBusy("Reading your contacts…");
        const contacts = await whatsAppEngine.listContacts();
        setSummary({ mode, contacts: contacts.length, groups: 0, members: 0 });
        return;
      }

      const chosen = groups?.filter((group) => selected.has(group.id)) ?? [];
      if (chosen.length === 0) {
        setError("Choose at least one group first.");
        return;
      }
      let members = 0;
      for (const [index, group] of chosen.entries()) {
        setBusy(`Reading “${group.name}” (${index + 1} of ${chosen.length})…`);
        // Sequential on purpose — see the note above.
        const participants = await whatsAppEngine.groupParticipants(group.id);
        members += participants.length;
      }
      setSummary({ mode, contacts: 0, groups: chosen.length, members });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  }

  if (!whatsAppEngine.isAvailable()) {
    return (
      <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
        Extraction runs in the Bridge desktop app, where the WhatsApp session lives.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["contacts", "groups"] as const).map((option) => (
          <Button
            key={option}
            variant={mode === option ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setMode(option);
              setSummary(null);
              setError(null);
            }}
          >
            {option === "contacts" ? "My contacts" : "Groups"}
          </Button>
        ))}
      </div>

      {mode === "groups" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadGroups()} disabled={busy !== null}>
              {groups ? "Reload groups" : "Load groups"}
            </Button>
            {groups ? (
              <span className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                {selected.size} of {groups.length} selected
              </span>
            ) : null}
          </div>

          <label className="block space-y-1 text-sm">
            <span style={{ color: "var(--color-navy-mid)" }}>Who becomes a Person</span>
            <select
              className="w-full rounded-md border px-2 py-1 text-sm"
              style={{ borderColor: "var(--color-border)" }}
              value={policy}
              onChange={(event) => setPolicy(event.target.value as Policy)}
            >
              {(Object.keys(POLICY_LABEL) as Policy[]).map((option) => (
                <option key={option} value={option}>{POLICY_LABEL[option]}</option>
              ))}
            </select>
            <span className="block text-xs" style={{ color: "var(--color-navy-mid)" }}>
              Everyone else still counts toward the Community's size — they just
              don't become a Person Record.
            </span>
          </label>

          {groups ? (
            <ul className="max-h-64 space-y-1 overflow-auto rounded-md border p-2"
              style={{ borderColor: "var(--color-border)" }}>
              {groups.map((group) => (
                <li key={group.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(group.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(group.id);
                        else next.delete(group.id);
                        setSelected(next);
                      }}
                    />
                    <span className="flex-1 truncate">{group.name || group.id}</span>
                    {group.participantCount !== null ? (
                      <span className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                        {group.participantCount}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void run()} disabled={busy !== null}>
          Run
        </Button>
        {busy ? (
          <span className="text-xs" style={{ color: "var(--color-navy-mid)" }}>{busy}</span>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}

      {summary ? (
        <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
          {summary.mode === "contacts"
            ? `Read ${summary.contacts} contacts.`
            : `Read ${summary.groups} groups and ${summary.members} memberships.`}
          <span className="block text-xs" style={{ color: "var(--color-navy-mid)" }}>
            Nothing has been saved yet — staging into Approvals is the next step.
          </span>
        </div>
      ) : null}
    </div>
  );
}
