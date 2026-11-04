/**
 * Per-visitor rate limits for client messages: the "Rate limit" column of the spec 04
 * client → server table, as token buckets (spec 05 § Handling a message, step 4).
 * test/limits.test.ts reads the spec table and fails if the two drift apart.
 */
import { BELL_COOLDOWN_MS, GESTURE_COOLDOWN_MS, JAPA_MALA_MIN_MS, POS_MAX_HZ } from "./constants";
import type { ClientMessageType } from "./messages";

export interface RateLimit {
  /** One token comes back every `everyMs`. */
  readonly everyMs: number;
  /** Bucket size: how many may arrive back to back. */
  readonly burst: number;
}

const perSecond = { everyMs: 1000, burst: 1 } as const;

export const RATE_LIMITS: { readonly [K in ClientMessageType]: RateLimit } = {
  pos: { everyMs: 1000 / POS_MAX_HZ, burst: 20 },
  gesture: { everyMs: GESTURE_COOLDOWN_MS, burst: 1 },
  bell: { everyMs: BELL_COOLDOWN_MS, burst: 1 },
  sit: perSecond,
  stand: perSecond,
  "diya.request": perSecond,
  "diya.light": perSecond,
  "diya.cancel": perSecond,
  "jal.request": perSecond,
  "jal.done": perSecond,
  "jal.cancel": perSecond,
  "japa.mala": { everyMs: JAPA_MALA_MIN_MS, burst: 1 },
  // The burst covers the three samples sent 500 ms apart after each welcome (spec 04 § Clock sync).
  time: { everyMs: 2000, burst: 5 },
  // Once: the socket closes straight after.
  leave: { everyMs: Number.POSITIVE_INFINITY, burst: 1 },
};
