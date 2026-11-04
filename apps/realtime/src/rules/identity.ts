/**
 * New visitors' ids, names and looks (spec 04 § Shared types, spec 05 § Names), and resume
 * tokens (spec 05 § Resume). Randomness is passed in so tests can be exact.
 */
import {
  NAME_KEYS,
  NAME_NUMBER_MAX,
  NAME_NUMBER_MIN,
  NAME_NUMBERS_EXCLUDED,
  SHAWL_COUNT,
  type HallId,
  type Visitor,
  type VisitorId,
} from "@sannidhi/protocol";

/** Uniform integer in [0, n). */
export type RandomInt = (n: number) => number;

export const cryptoRandomInt: RandomInt = (n) => {
  // Rejection sampling keeps it uniform; n is always small here.
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] ?? 0;
    if (v < limit) return v % n;
  }
};

const LETTERS = "abcdefghijkmnpqrstuvwxyz";
const ALNUM = "abcdefghijkmnpqrstuvwxyz23456789";

/** A short id like "k3", unique among `taken`. Grows by a character if the short ones run out. */
export function newVisitorId(
  taken: ReadonlySet<VisitorId>,
  rand: RandomInt = cryptoRandomInt,
): VisitorId {
  for (let len = 2; ; len++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      let id = LETTERS[rand(LETTERS.length)] ?? "a";
      while (id.length < len) id += ALNUM[rand(ALNUM.length)] ?? "a";
      if (!taken.has(id)) return id;
    }
  }
}

/** A new visitor's profile: a curated name with a number unique in the instance, shawl and body. */
export function newVisitor(
  id: VisitorId,
  takenNumbers: ReadonlySet<number>,
  now: number,
  rand: RandomInt = cryptoRandomInt,
): Visitor {
  const span = NAME_NUMBER_MAX - NAME_NUMBER_MIN + 1;
  let n = NAME_NUMBER_MIN + rand(span);
  // An instance holds at most a few dozen visitors and records, so this always finds a gap.
  const unavailable = (k: number): boolean =>
    takenNumbers.has(k) || NAME_NUMBERS_EXCLUDED.includes(k);
  for (let i = 0; i < span && unavailable(n); i++) {
    n = n === NAME_NUMBER_MAX ? NAME_NUMBER_MIN : n + 1;
  }
  return {
    id,
    name: { key: NAME_KEYS[rand(NAME_KEYS.length)] ?? "deodar", n },
    shawl: rand(SHAWL_COUNT),
    body: rand(2) === 0 ? 0 : 1,
    joinedAt: now,
  };
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "<hall>.<instance>.<128-bit random, base64url>" (spec 05 § Resume). */
export function newResumeToken(hall: HallId, instance: number): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${hall}.${instance}.${base64url(bytes)}`;
}
