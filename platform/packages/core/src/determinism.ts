/**
 * Determinism discipline (roadmap P1, backlog #23).
 *
 * Engine code NEVER calls `Date.now()` or `Math.random()` directly. Time and
 * randomness are injected through a `Clock` and `Rng` carried on the request
 * context, so any pipeline run is replayable from the ledger: same inputs +
 * same seed + same clock => same outputs, same ids.
 */

export interface Clock {
  /** Current instant, ISO-8601 string (matches Postgres `timestamptz` text). */
  nowISO(): string;
  /** Current instant, epoch milliseconds. */
  nowMs(): number;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

/**
 * Monotonic, seedable id generator. Two faithful shapes implement this:
 * `UlidGen` (sortable Crockford-base32) and `UuidGen` (RFC-4122 — required
 * wherever ids land in Postgres `uuid` columns, e.g. the `ledger` PK).
 */
export interface IdGen {
  next(): string;
}

/** A clock fixed at a single instant — for tests and deterministic replay. */
export class FixedClock implements Clock {
  #ms: number;
  constructor(startISO: string) {
    this.#ms = Date.parse(startISO);
    if (Number.isNaN(this.#ms)) throw new Error(`FixedClock: bad ISO "${startISO}"`);
  }
  nowISO(): string {
    return new Date(this.#ms).toISOString();
  }
  nowMs(): number {
    return this.#ms;
  }
  /** Advance the clock (tests simulate elapsed time without wall-clock waits). */
  advance(ms: number): void {
    this.#ms += ms;
  }
}

/** Wall-clock. The ONLY place `Date.now` is allowed — at the system boundary. */
export class SystemClock implements Clock {
  nowISO(): string {
    return new Date(this.nowMs()).toISOString();
  }
  nowMs(): number {
    // eslint-disable-next-line no-restricted-syntax -- boundary adapter only
    return Date.now();
  }
}

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
export class SeededRng implements Rng {
  #state: number;
  constructor(seed: number) {
    this.#state = seed >>> 0;
  }
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Deterministic, monotonic, ULID-shaped id generator.
 *
 * Time component from the injected clock, entropy from the injected Rng. A
 * per-instance counter guarantees strict monotonicity within the same
 * millisecond, so ids stay sortable and collision-free under replay.
 */
export class UlidGen implements IdGen {
  #clock: Clock;
  #rng: Rng;
  #lastMs = -1;
  #counter = 0;

  constructor(clock: Clock, rng: Rng) {
    this.#clock = clock;
    this.#rng = rng;
  }

  next(): string {
    const ms = this.#clock.nowMs();
    if (ms === this.#lastMs) {
      this.#counter += 1;
    } else {
      this.#lastMs = ms;
      this.#counter = 0;
    }
    const time = encodeTime(ms, 10);
    const rand = encodeRandom(this.#rng, this.#counter, 16);
    return time + rand;
  }
}

/**
 * Deterministic, RFC-4122-shaped id generator. UUID v7-flavored: a 48-bit time
 * prefix (sortable) + seeded entropy, with a per-instance counter folded into
 * the tail so same-millisecond ids stay collision-free under replay. Use this
 * (not UlidGen) anywhere ids are written to Postgres `uuid` columns — the
 * `ledger` PK, Automation Run ids, etc. Same seed + clock => identical uuids.
 */
export class UuidGen implements IdGen {
  #clock: Clock;
  #rng: Rng;
  #lastMs = -1;
  #counter = 0;

  constructor(clock: Clock, rng: Rng) {
    this.#clock = clock;
    this.#rng = rng;
  }

  next(): string {
    const ms = this.#clock.nowMs();
    if (ms === this.#lastMs) {
      this.#counter += 1;
    } else {
      this.#lastMs = ms;
      this.#counter = 0;
    }
    const b = new Uint8Array(16);
    // bytes 0..5: 48-bit big-endian time prefix (keeps ids time-sortable).
    let t = ms;
    for (let i = 5; i >= 0; i--) {
      b[i] = t & 0xff;
      t = Math.floor(t / 256);
    }
    // bytes 6..13: seeded entropy.
    for (let i = 6; i < 14; i++) b[i] = Math.floor(this.#rng.next() * 256) & 0xff;
    // bytes 14..15: monotonic counter — collision-free within a millisecond.
    b[14] = (this.#counter >> 8) & 0xff;
    b[15] = this.#counter & 0xff;
    // Stamp version (4) and RFC-4122 variant.
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

/**
 * Real (non-deterministic, wall-clock) UUIDv7 generator — RFC 9562 layout:
 * 48-bit big-endian unix-ms timestamp + version nibble (0111) + 12 random bits
 * + variant bits (10) + 62 random bits. Distinct from `UuidGen` above: `UuidGen`
 * is a seeded/replayable id generator for pipeline request contexts (stamped as
 * version 4 for historical reasons and intentionally left alone here — changing
 * its byte layout is out of scope and would ripple through every test that
 * constructs one). This function is the plain, no-DI id generator wired as the
 * Postgres column DEFAULT for the three append-only, high-write tables that
 * benefit from time-ordered (not random) primary keys: `ledger`, `events`,
 * `timeline_entries` (see platform/packages/db/src/schema.ts, migration
 * 0004_schema_hardening.sql). No native `uuidv7()` exists in Postgres before v18
 * and Supabase/pglite are both pre-v18, so generation happens in JS at insert
 * time via Drizzle's `$defaultFn`, matching this repo's existing convention of
 * NOT reaching for a new npm dependency for a ~20-line algorithm.
 */
export function uuidv7(): string {
  const ms = Date.now();
  const b = new Uint8Array(16);
  // bytes 0..5: 48-bit big-endian time prefix (time-sortable primary keys).
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  // bytes 6..15: cryptographically-random tail.
  crypto.getRandomValues(b.subarray(6));
  // Stamp version 7 (0111) and RFC-4122/9562 variant (10).
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function encodeTime(ms: number, len: number): string {
  let out = "";
  let n = ms;
  for (let i = 0; i < len; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(rng: Rng, counter: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    // Fold the monotonic counter into the high chars so same-ms ids sort.
    const mixed = i < 4 ? (counter >> (i * 5)) & 31 : Math.floor(rng.next() * 32);
    out += CROCKFORD[mixed & 31];
  }
  return out;
}
