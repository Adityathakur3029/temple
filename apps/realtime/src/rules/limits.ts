/**
 * Rate limits and strikes (spec 05 § Handling a message, steps 4 and 6).
 * Token buckets live in memory only: after hibernation every bucket starts full again, which
 * spec 05 § State allows ("not needed after wake").
 */
import {
  RATE_LIMITS,
  STRIKE_LIMIT,
  type ClientMessageType,
  type RateLimit,
} from "@sannidhi/protocol";

/** Strikes are counted over this window. */
export const STRIKE_WINDOW_MS = 60_000;
/** At most one `error {code:"rate_limited"}` per visitor in this time. */
export const RATE_ERROR_EVERY_MS = 10_000;

interface Bucket {
  tokens: number;
  at: number;
}

/** One visitor's buckets, one per message type. */
export class Buckets {
  private readonly buckets = new Map<ClientMessageType, Bucket>();
  lastRateError = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limits: { readonly [K in ClientMessageType]: RateLimit } = RATE_LIMITS,
  ) {}

  /** Takes a token for `type` at time `now`. False means over the limit: drop and strike. */
  take(type: ClientMessageType, now: number): boolean {
    const limit = this.limits[type];
    let b = this.buckets.get(type);
    if (!b) {
      b = { tokens: limit.burst, at: now };
      this.buckets.set(type, b);
    } else if (Number.isFinite(limit.everyMs)) {
      const refill = (now - b.at) / limit.everyMs;
      if (refill > 0) {
        b.tokens = Math.min(limit.burst, b.tokens + refill);
        b.at = now;
      }
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

/**
 * Adds a strike at `now` to a visitor's list (kept in the WebSocket attachment, so it survives
 * hibernation) and drops strikes older than the window. True means close with 4008.
 */
export function addStrike(strikes: number[], now: number): boolean {
  const cutoff = now - STRIKE_WINDOW_MS;
  let drop = 0;
  while (drop < strikes.length && (strikes[drop] ?? 0) <= cutoff) drop++;
  strikes.splice(0, drop);
  strikes.push(now);
  return strikes.length > STRIKE_LIMIT;
}
