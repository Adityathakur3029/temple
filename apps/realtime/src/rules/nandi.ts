/** Whisper to Nandi (spec 03 § Whisper to Nandi): the visitor must stand beside one of his ears. */
import { NANDI_EAR_REACH_M, NANDI_EAR_SPOTS, distance, type Point } from "@sannidhi/protocol";

/** The server allows 1 m more than the client's button distance, for lag. */
export const NANDI_EAR_SERVER_REACH_M = NANDI_EAR_REACH_M + 1;

export function inNandiEarReach(at: Point): boolean {
  return NANDI_EAR_SPOTS.some((s) => distance(at, s) <= NANDI_EAR_SERVER_REACH_M);
}
