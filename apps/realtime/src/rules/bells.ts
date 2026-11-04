/** Ring a bell (spec 03 § Ring a bell): reach, and a per-bell cap across all visitors. */
import {
  BELL_MAX_PER_SEC,
  BELL_REACH_M,
  BELLS,
  distance,
  type BellId,
  type Point,
} from "@sannidhi/protocol";

/** The server allows 1 m more than the client's button distance, for lag. */
export const BELL_SERVER_REACH_M = BELL_REACH_M + 1;

export function inBellReach(at: Point, bell: BellId): boolean {
  return distance(at, BELLS[bell]) <= BELL_SERVER_REACH_M;
}

/** Recent accepted rings per bell. Memory only (spec 05 § State). */
export class BellWindows {
  private readonly rings = new Map<BellId, number[]>();

  /** True if this ring may sound; false means drop it silently so the hall never sounds chaotic. */
  allow(bell: BellId, now: number): boolean {
    const list = (this.rings.get(bell) ?? []).filter((t) => now - t < 1000);
    if (list.length >= BELL_MAX_PER_SEC) {
      this.rings.set(bell, list);
      return false;
    }
    list.push(now);
    this.rings.set(bell, list);
    return true;
  }
}
