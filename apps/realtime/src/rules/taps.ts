/** Wash hands (spec 03 § Wash hands): the visitor must be at the tap. Taps are not reserved. */
import { TAP_REACH_M, TAPS, distance, type Point, type TapId } from "@sannidhi/protocol";

/** The server allows 1 m more than the client's button distance, for lag. */
export const TAP_SERVER_REACH_M = TAP_REACH_M + 1;

export function inTapReach(at: Point, tap: TapId): boolean {
  return distance(at, TAPS[tap]) <= TAP_SERVER_REACH_M;
}
