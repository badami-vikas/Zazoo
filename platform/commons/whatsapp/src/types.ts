/**
 * Value types for one WhatsApp extraction run.
 *
 * These describe what the desktop shell's read-op allowlist returns — nothing
 * here knows how it was obtained. The shell reads through wa-js inside the
 * user's own live WhatsApp Web session; this package only maps the result.
 *
 * Everything crossing into this package is UNTRUSTED external content: names
 * and push-names are attacker-controllable strings set by third parties, so
 * they are treated as data and never as identifiers.
 */

/** One WhatsApp contact, as reported by a read op. */
export interface WhatsAppContact {
  /** WhatsApp id, e.g. "919876543210@c.us" (individual) or "…@g.us" (group). */
  id: string;
  /** The name the OWNER saved in their address book, when there is one. */
  name?: string;
  /** The display name the contact set for themselves. Never authoritative. */
  pushname?: string;
  /** Digits as WhatsApp reports them, unformatted. */
  phone?: string;
  /** True when this contact is in the owner's address book. */
  isMyContact: boolean;
  isGroup: boolean;
}

/** One WhatsApp group and the participants a read op resolved for it. */
export interface WhatsAppGroup {
  id: string;
  name: string;
  participants: WhatsAppContact[];
}

/** The payload of a single extraction run, discriminated by what was read. */
export type WhatsAppExtraction =
  | {
      kind: "contacts";
      runId: string;
      /** ISO-8601 capture time, supplied by the caller — this package has no clock. */
      capturedAt: string;
      contacts: WhatsAppContact[];
    }
  | {
      kind: "groups";
      runId: string;
      capturedAt: string;
      groups: WhatsAppGroup[];
    };

// ── Proposals ────────────────────────────────────────────────────────────────
// Capture is not commit. Mapping produces PROPOSALS; nothing here writes to a
// graph. The Approvals path decides what becomes a Record.

/**
 * Which participants of a group become People.
 *
 * At real scale this is not a detail: one 1,146-member group would otherwise
 * stage over a thousand proposals, nearly all strangers who happen to share a
 * group with the owner.
 */
export type ParticipantPolicy =
  /** Only participants already in the owner's address book. */
  | "contacts"
  /** Address book plus anyone the owner has a direct chat with. */
  | "contacts_and_messaged"
  /** Everyone in the group. */
  | "all";

/** How a Person's identity is known — the two spaces never mix. */
export type IdentityKind = "phone" | "lid";

/** Propose a new Person, or link a contact to one that already exists. */
export interface PersonProposal {
  /** Stable key: `whatsapp:+E164` or `whatsapp-lid:<id>`. */
  dedupeKey: string;
  /** Existing Person this contact resolved to, when exactly one matched. */
  matchedPersonId?: string;
  displayName: string;
  /**
   * `lid` means WhatsApp disclosed no phone number for this contact. Such a
   * Person is real and keeps their name, but cannot be matched against phone
   * or email identities — the UI must say so rather than imply a missing field.
   */
  identityKind: IdentityKind;
  /** E.164 phone. LOCAL PLANE ONLY, and absent for every `lid` identity. */
  phoneE164?: string;
  /** The capture run this proposal came from, so an approval is traceable. */
  runId: string;
}

/** Per-run participant selection, including the run panel's per-group choice. */
export interface GroupExtractionOptions {
  /** Applied to any group without an explicit override. */
  defaultPolicy: ParticipantPolicy;
  /** Per-group override, keyed by WhatsApp group id. */
  policyByGroupId?: Readonly<Record<string, ParticipantPolicy>>;
  /** Ids in the owner's address book. Falls back to each contact's own flag. */
  contactIds?: ReadonlySet<string>;
  /** Ids the owner has a direct chat with (the `list_direct_chats` read op). */
  messagedIds?: ReadonlySet<string>;
}

/** Propose a Community for a WhatsApp group. */
export interface CommunityProposal {
  /** Stable key derived from the WhatsApp group id. */
  dedupeKey: string;
  name: string;
  /** WhatsApp group id, retained so a re-run maps to the same Community. */
  sourceGroupId: string;
  /** Everyone in the group, including those the policy did not propose. */
  participantCount: number;
  /** How many of them became Person proposals under the applied policy. */
  proposedMemberCount: number;
  /** The policy actually applied, so the review surface can explain the gap. */
  policy: ParticipantPolicy;
  runId: string;
}

/** Propose membership of a Person in a Community. */
export interface RelationProposal {
  personDedupeKey: string;
  communityDedupeKey: string;
  kind: "community_member";
  runId: string;
}

/**
 * An ambiguous match. Two or more existing People share this contact's
 * identity, so the run refuses to guess: it files a Signal for manual cleanup
 * and proposes neither a link nor a new Person.
 */
export interface DuplicateSignal {
  kind: "possible_duplicate";
  dedupeKey: string;
  displayName: string;
  candidatePersonIds: string[];
  runId: string;
}

export interface ExtractionResult {
  people: PersonProposal[];
  communities: CommunityProposal[];
  relations: RelationProposal[];
  signals: DuplicateSignal[];
}

/**
 * Existing local People, indexed by dedupe key. A key maps to a LIST because
 * "more than one match" must be representable — that is the case that has to
 * become a Signal rather than a silent pick.
 */
export interface ExistingPersonIndex {
  byDedupeKey: Map<string, string[]>;
}
