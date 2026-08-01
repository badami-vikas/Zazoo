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
import { dedupeKeyFor, displayNameFor, groupDedupeKeyFor, toE164 } from "./normalize.js";
import type {
  CommunityProposal,
  ExistingPersonIndex,
  ExtractionResult,
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

export function mapExtraction(
  extraction: WhatsAppExtraction,
  existing: ExistingPersonIndex,
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
    const phoneE164 = toE164(contact.phone) ?? toE164(contact.id);
    const proposal: PersonProposal = {
      dedupeKey,
      displayName: displayNameFor(contact),
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
    const communityDedupeKey = groupDedupeKeyFor(group.id);
    const community: CommunityProposal = {
      dedupeKey: communityDedupeKey,
      name: group.name,
      sourceGroupId: group.id,
      runId: extraction.runId,
    };
    result.communities.push(community);

    for (const participant of group.participants) {
      const personDedupeKey = considerPerson(participant);
      if (!personDedupeKey) continue;
      const relation: RelationProposal = {
        personDedupeKey,
        communityDedupeKey,
        kind: "community_member",
        runId: extraction.runId,
      };
      result.relations.push(relation);
    }
  }

  return result;
}
