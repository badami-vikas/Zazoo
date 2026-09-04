/**
 * Map one WhatsApp extraction into intake proposals.
 *
 * Pure: no clock, no id generation, no I/O. The matching rules mirror the
 * Google intake pipeline deliberately, because the failure modes are the same:
 *
 *   exactly one match → link to that Person
 *   several matches   → possible_duplicate Signal; NEVER auto-merge
 *   no match          → propose a new Person
 *
 * Nothing here commits. The Approvals path turns proposals into Records.
 */
import { dedupeKeyFor, displayNameFor, groupDedupeKeyFor, isLidId, phoneFor } from "./normalize.js";
import type {
  CommunityProposal,
  ExistingPersonIndex,
  ExtractionResult,
  GroupExtractionOptions,
  ParticipantPolicy,
  PersonProposal,
  RelationProposal,
  WhatsAppContact,
  WhatsAppExtraction,
} from "./types.js";

export function emptyPersonIndex(): ExistingPersonIndex {
  return { byDedupeKey: new Map() };
}

/** Build the match index from local People rows. */
export function personIndexFrom(
  rows: readonly { personId: string; dedupeKey: string }[],
): ExistingPersonIndex {
  const byDedupeKey = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byDedupeKey.get(row.dedupeKey);
    if (existing) existing.push(row.personId);
    else byDedupeKey.set(row.dedupeKey, [row.personId]);
  }
  return { byDedupeKey };
}

/**
 * Default when a run supplies no options: address book plus anyone the owner
 * has actually messaged. Chosen over `all` because a group's membership is not
 * a relationship — measured on a live account, `all` would stage 35,298 People
 * against 998 who are genuinely known.
 */
const DEFAULT_OPTIONS: GroupExtractionOptions = { defaultPolicy: "contacts_and_messaged" };

/** Does this participant clear the policy applied to their group? */
function isIncluded(
  participant: WhatsAppContact,
  policy: ParticipantPolicy,
  options: GroupExtractionOptions,
): boolean {
  if (policy === "all") return true;
  const known = options.contactIds
    ? options.contactIds.has(participant.id)
    : participant.isMyContact;
  if (known) return true;
  if (policy === "contacts") return false;
  return options.messagedIds?.has(participant.id) ?? false;
}

export function mapExtraction(
  extraction: WhatsAppExtraction,
  existing: ExistingPersonIndex,
  options: GroupExtractionOptions = DEFAULT_OPTIONS,
): ExtractionResult {
  const result: ExtractionResult = { people: [], communities: [], relations: [], signals: [] };
  // One proposal per identity per run, even when a contact appears in several
  // groups or twice in one contact list.
  const seenPeople = new Set<string>();

  const considerPerson = (contact: WhatsAppContact): string | undefined => {
    const dedupeKey = dedupeKeyFor(contact);
    // No derivable identity: skip. Inventing a key here would create a Person
    // that can never be matched again on a later run.
    if (!dedupeKey) return undefined;
    if (seenPeople.has(dedupeKey)) return dedupeKey;

    const matches = existing.byDedupeKey.get(dedupeKey) ?? [];
    if (matches.length > 1) {
      seenPeople.add(dedupeKey);
      result.signals.push({
        kind: "possible_duplicate",
        dedupeKey,
        displayName: displayNameFor(contact),
        candidatePersonIds: [...matches],
        runId: extraction.runId,
      });
      // Ambiguous: propose neither a link nor a new Person. The membership
      // Relation is withheld too — it would have to guess which Person.
      return undefined;
    }

    seenPeople.add(dedupeKey);
    // Absent for @lid contacts — WhatsApp discloses no number for those, and
    // the proposal must say so rather than fabricate one.
    const phoneE164 = phoneFor(contact);
    const proposal: PersonProposal = {
      dedupeKey,
      displayName: displayNameFor(contact),
      identityKind: isLidId(contact.id) || !phoneE164 ? "lid" : "phone",
      runId: extraction.runId,
      ...(matches[0] ? { matchedPersonId: matches[0] } : {}),
      ...(phoneE164 ? { phoneE164 } : {}),
    };
    result.people.push(proposal);
    return dedupeKey;
  };

  if (extraction.kind === "contacts") {
    for (const contact of extraction.contacts) considerPerson(contact);
    return result;
  }

  for (const group of extraction.groups) {
    const policy = options.policyByGroupId?.[group.id] ?? options.defaultPolicy;
    const communityDedupeKey = groupDedupeKeyFor(group.id);
    let proposedMemberCount = 0;

    for (const participant of group.participants) {
      if (!isIncluded(participant, policy, options)) continue;
      const personDedupeKey = considerPerson(participant);
      if (!personDedupeKey) continue;
      proposedMemberCount += 1;
      const relation: RelationProposal = {
        personDedupeKey,
        communityDedupeKey,
        kind: "community_member",
        runId: extraction.runId,
      };
      result.relations.push(relation);
    }

    const community: CommunityProposal = {
      dedupeKey: communityDedupeKey,
      name: group.name,
      sourceGroupId: group.id,
      // The full size is kept even though most members get no Person Record,
      // so the Community reads honestly as "12 of 1,146 known to you".
      participantCount: group.participants.length,
      proposedMemberCount,
      policy,
      runId: extraction.runId,
    };
    result.communities.push(community);
  }

  return result;
}
