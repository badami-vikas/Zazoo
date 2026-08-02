# TASK-030 Track C — Local Plane message store and send discipline

Date: 2026-08-02 · Tier C · ADR-158 · AP-091 · TASK-030

Scope delivered: C1 (Local Plane message store with full-text and fuzzy search) and
C2 (rate/ban discipline as a pure, testable module composing with `decideSend`).

---

## 1. The pglite extension premise was half wrong — verified

The brief stated that pglite 0.2.17 ships `pg_trgm` and `vector`, so no new dependency is
needed, and asked for that to be verified rather than trusted. It was verified, and the
conclusion needs a correction that changes the design.

**Verified by direct probe and now by test** (`packages/local/test/messages.test.ts`,
"pg_trgm ships with pglite but is NOT available unless registered"):

| Claim | Finding |
| --- | --- |
| pglite 0.2.17 ships `pg_trgm` | TRUE — `@electric-sql/pglite/contrib/pg_trgm` resolves and works |
| pglite 0.2.17 ships `vector` | TRUE — `@electric-sql/pglite/vector` resolves (not used here) |
| No new dependency needed | TRUE — no package added |
| `pg_trgm` is therefore available | **FALSE** |

A bare `new PGlite()` lists exactly one available extension, `plpgsql`.
`CREATE EXTENSION pg_trgm` fails with `extension "pg_trgm" is not available`, and
`gin_trgm_ops` does not exist. The module must be registered at client construction:
`new PGlite(dir, { extensions: { pg_trgm } })`. Only then does `CREATE EXTENSION` succeed.

**A sharper hazard, also verified.** Once `pg_trgm` is installed into a *persisted*
database and a trigram index exists, reopening that directory with a client that did not
register the extension breaks **every query touching the table** — including plain
`ILIKE` and `count(*)` — with `could not access file "$libdir/pg_trgm": No such file or
directory`. The catalog row survives the client, so `CREATE EXTENSION IF NOT EXISTS`
succeeds as a no-op and the catalog *claims* the extension is present while the shared
library is not loaded. Catalog inspection cannot detect this state.

Handled three ways:

1. `createPgliteLocalPlane` registers `LOCAL_PLANE_PGLITE_EXTENSIONS` on every client it
   constructs, and that constant is exported for callers who pass their own `client`.
2. Availability is probed **functionally** (`SELECT similarity(...)`), not from the
   catalog, because only evaluating a function proves the library resolved.
3. If the trigram index exists but the probe fails, initialization throws a message naming
   the cause and the fix, instead of letting an opaque `$libdir` error surface later on an
   unrelated query. Covered by test.

Consequence for the architecture: **core full-text search is unconditional; trigram is
not.** `tsvector` + GIN is core Postgres and is always created. Trigram is created only
when the extension really loaded, and fuzzy search degrades to an escaped `ILIKE`
substring scan otherwise — slower and typo-intolerant, but it returns real rows rather
than silently none. `messageSearchCapabilities()` reports which is in force rather than
leaving a caller to guess.

## 2. C1 — the message store

`local_messages` (organization_id, source, message_id) carries chat id, sender identity,
direction, timestamp, body, attachment descriptor, ack, capture time. Local Plane only:
a body has no promote path to cloud canonical, the same rule as `local_people.phones`
and for stronger reasons.

- **Full text**: GIN index on `to_tsvector('simple', body)`, queried with
  `websearch_to_tsquery` and ranked by `ts_rank`. `simple` rather than `english` because
  the live address book is multilingual and the `english` configuration would stem and
  drop stopwords in every language's text. Verified by test with Devanagari text and with
  an all-English-stopword body, both of which `english` would have indexed as empty.
  `websearch_to_tsquery` also means hostile query text (`&&&`, a SQL-injection string)
  cannot raise — tested.
- **Fuzzy**: `word_similarity(query, body)` with the `<%` operator, not `similarity()`.
  `similarity` compares against the whole body, so a short query inside a long message
  scores near zero; `word_similarity` scores the best-matching span, which is what a
  search box means. Verified: `invoise` finds "quarterly invoice" in fuzzy mode and finds
  nothing in full-text mode.
- **Migration follows the existing additive pattern.** `migrateLocalMessageColumns` runs
  *before* `INIT_SQL`, exactly as `migrateLocalPeopleIdentityColumns` does, and the search
  indexes run *after* it because they need the table and are conditional in a way plain SQL
  cannot express. Verified by a test that installs a deliberately narrow four-column
  `local_messages` with a row in it, opens the plane, and asserts the row survived, the
  new columns defaulted, and a full write now succeeds.

### Identity — the non-negotiable rule

Enforced at the storage boundary in `packages/local/src/messages.ts`, so both the pglite
and in-memory adapters apply the identical rule and no caller can route around it.
`senderKey` and `senderKind` are checked against each other; a mismatch throws rather
than being coerced, because silently "fixing" an inconsistent sender is how the
fabricated-number bug stayed invisible.

Verified by test:

- a `whatsapp-lid:` key declared as kind `phone` is refused;
- **`whatsapp:+218472398472@lid` is refused** — the exact 2026-08-01 laundering shape,
  where the extractor had already written LID digits into a phone-shaped field, and where
  guarding the id suffix alone was insufficient;
- a phone key that is not `whatsapp:+<digits>` is refused;
- the same digits in the two spaces do not resolve to each other on lookup;
- a kind requiring a key cannot be stored without one, and an unattributed sender stays
  `unknown` rather than being guessed;
- a batch containing one bad message writes none of it.

`getThreadActivity` was added alongside, because the consent gate needs "did they write
first" to be a stored fact rather than an assumption.

### Port widening

`LocalGraphStore` gained five message methods, as directed. The
`integrations-google/test/intake.test.ts` fixture implements them inertly with a comment
saying why (Google intake stores raw payloads through `BodyStore` and never writes a
`local_messages` row). The port was not weakened. `apps/api` also depends on
`@bridge/local` and still builds.

## 3. C2 — send discipline

`modules/whatsapp/src/policy.ts`. Pure: no clock, no RNG, no I/O, no transport. `now`, the
recipient's UTC offset and the jitter draw are all inputs. Nothing in the file needs
anything a second implementation could not do — integer/float arithmetic, ISO-8601
instants, string comparison — so the ceiling can be re-enforced in Rust per ADR-158.
`SEND_POLICY_LIMITS` is the constant set a Rust enforcer mirrors.

All rules verified by test, including the adversarial cases the brief named:

| Rule | Behaviour | Boundary tested |
| --- | --- | --- |
| Consent gate | **Refused** | first contact; a thread we wrote in but they never answered; an inbound count with no timestamp; refuses *before* any approval prompt |
| Daily cap (30) | Deferred, rolling 24h | `cap - 1` allowed, `cap` binds; 25h-old sends do not count |
| Recipient cooldown (7d) | Deferred | releases exactly at the boundary |
| Near-identical bodies | **Refused** | binds at the 5th recipient, allowed at the 4th; same recipient repeatedly is not a bulk signature; window expiry |
| Warm-up ramp | Deferred | day 0 cap 5, +5/day, clamped at 30; future link date sends nothing |
| Recipient hours (9–21) | Deferred | positive and negative offsets; start inclusive, end exclusive; unknown offset is **refused**, not assumed daytime |
| Jitter 30s–15min | — | clamps negative, >1, NaN, Infinity; pure in its draw |
| Kill switch | **Refused** | does not auto-resume after six years; halting twice keeps the first reason; re-arm requires a named human |

Design choices worth recording:

- **Rolling 24h, not calendar day.** A calendar reset invites a burst at midnight, which
  is a worse behavioural signature than the steady rate the cap exists to produce.
- **Similarity measure: Jaccard over character trigrams.** Chosen over exact hashing,
  which is defeated by inserting the recipient's first name and would catch nothing real;
  and over Levenshtein, which is O(n·m) on 4,096-character bodies and whose score is
  dominated by length difference. Trigram Jaccard is order-insensitive, robust to
  substitution, linear, needs no per-language dictionary, is the same family of measure as
  `pg_trgm`'s `similarity()` so the store and the policy mean the same thing by "similar",
  and is trivially reimplementable in Rust. Verified to score a swapped-name mail-merge
  pair above threshold and two genuinely different messages below it.
- **Consent gate default.** The binding rule is that the recipient has written into the
  thread at all — a reply *is* the consent signal, so a thread the owner opened by hand
  and the recipient answered is consented. `requireRecipientInitiated` tightens this to
  the literal "they sent the first message" reading for callers who want it. Both tested.
  The never-negotiable half — automation never opens a conversation — is unconditional.
- **Refusals are ordered before deferrals**, and in `decideAutomatedSend` policy refusals
  run *before* `decideSend`. A first-contact or halted send is never turned into an
  approval prompt: asking a human to approve something the system will refuse anyway is
  how people learn to click through prompts, and the consent prompt is exactly the one
  that must never become reflexive. Tested.
- **Jitter is not described as a cloak** anywhere in the code, and the comment at both its
  definition and its use says so explicitly: if the underlying behaviour is bulk outreach,
  no timing randomisation makes it acceptable — the other rules decide that. It exists so
  automated sending is actually human-paced.

## 4. Verification

| Check | Result |
| --- | --- |
| `@bridge/local` build | pass |
| `@bridge/local` tests | **37 pass, 0 fail** (24 new), lines 84.54% vs 70% gate |
| `@bridge/whatsapp` build + `node --test` over `dist/` | **87 pass, 0 fail** (was 47; 40 new), lines 99.02% vs 70% gate, `policy.js` 100% |
| `@bridge/integrations-google` build + tests | **39 pass, 0 fail** — fixture fixed |
| `@bridge/api` build | pass (only other `@bridge/local` dependent) |
| eslint over all changed files | clean |

## 5. Unverified / honest limits

- **Encryption at rest is not solved.** pglite writes to a directory in the user's home.
  "The disk is encrypted" is the user's FileVault setting, not a guarantee Bridge makes.
  ADR-158 records this as an accepted, documented limitation; nothing here changes it, and
  storing third parties' message bodies makes it materially larger.
- **The Rust-side ceiling is not implemented here.** `.rs` files are out of this track's
  scope. Until it exists, the cap is renderer-side only and therefore bypassable —
  ADR-158's own words: a cap that does not bind is not protection. `SEND_POLICY_LIMITS`
  is the constant set the Rust implementation must mirror; if the two diverge, the Rust
  copy is the real one.
- **Not tested at scale.** All store tests run on tens of rows. Index behaviour on a
  synced multi-year history is unmeasured; `listMessages` defaults to 500 rows and has no
  pagination cursor yet.
- **No timezone database.** The policy takes a UTC offset in minutes, not an IANA zone.
  Resolving a zone to an offset (including DST) is the caller's job, deliberately, so a
  second implementation does not have to agree with us about tz data.
- **Retention and deletion are not implemented.** The store grows without bound and there
  is no delete-a-thread or forget-a-person path. That is a data-protection gap ADR-158
  flags and this track did not close.
- **The in-memory adapter's search is substring-only.** It reports
  `{ fullText: false, trigram: false }` rather than approximating `ts_rank`, so a slice
  running zero-infra cannot mistake it for the real index.
