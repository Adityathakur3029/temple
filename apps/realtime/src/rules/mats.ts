/**
 * Seats (spec 03 § Sit on a mat, § Sit on a bench): one visitor per seat. Seat numbers are the
 * mats (0 … 39), then the bench seats (40 … 53).
 */
import {
  BENCH_SEATS,
  BENCH_SIT_NEAR_M,
  MATS,
  MAT_COUNT,
  SEATS,
  distance,
  inMandapa,
  seatKind,
  type Point,
} from "@sannidhi/protocol";

/** The nearest mat not in `held`, or −1 if every mat is held. */
export function nearestFreeMat(from: Point, held: ReadonlySet<number>): number {
  return nearestFree(from, held, 0, MATS.length, Number.POSITIVE_INFINITY);
}

/**
 * The seat "Sit" gives when none is named: the nearest free mat inside the mandapa, else the
 * nearest free bench seat within BENCH_SIT_NEAR_M, else −1.
 */
export function nearestFreeSeat(from: Point, held: ReadonlySet<number>): number {
  if (inMandapa(from.x, from.z)) return nearestFreeMat(from, held);
  return nearestFree(from, held, MAT_COUNT, MAT_COUNT + BENCH_SEATS.length, BENCH_SIT_NEAR_M);
}

/** Whether a visitor at `from` may be given seat `seat` (it may still be held by someone). */
export function maySit(from: Point, seat: number): boolean {
  const kind = seatKind(seat);
  if (kind === "mat") return inMandapa(from.x, from.z);
  const spot = SEATS[seat];
  return kind === "bench" && spot !== undefined && distance(from, spot) <= BENCH_SIT_NEAR_M;
}

function nearestFree(
  from: Point,
  held: ReadonlySet<number>,
  first: number,
  end: number,
  within: number,
): number {
  let best = -1;
  let bestD = within;
  for (let i = first; i < end; i++) {
    const s = SEATS[i];
    if (!s || held.has(i)) continue;
    const d = distance(from, s);
    if (d < bestD || (best < 0 && d <= within)) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
