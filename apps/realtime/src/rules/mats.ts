/** Mats (spec 03 § Sit on a mat): one visitor per mat, nearest free mat when none is named. */
import { MATS, distance, type Point } from "@sannidhi/protocol";

/** The nearest mat not in `held`, or −1 if every mat is held. */
export function nearestFreeMat(from: Point, held: ReadonlySet<number>): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  MATS.forEach((m, i) => {
    if (held.has(i)) return;
    const d = distance(from, m);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}
