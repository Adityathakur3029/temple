/** The hall list (spec 04 § Room list) and the default hall choice. */
import { HALL_IDS, type HallId, type RoomsResponse } from "@sannidhi/protocol";

/** A hall at or above this share of its capacity isn't chosen by default. */
export const BUSY_SHARE = 0.9;

/**
 * 1. The hall a resuming visitor was in. 2. Otherwise the fullest hall under 90% capacity, so
 * people find each other. 3. If every hall is busier than that, hall-01.
 */
export function chooseHall(rooms: RoomsResponse | null, resumeHall: HallId | null): HallId {
  if (resumeHall) return resumeHall;
  let best: { id: HallId; count: number } | null = null;
  for (const h of rooms?.halls ?? []) {
    if (h.count >= h.capacity * BUSY_SHARE) continue;
    if (!best || h.count > best.count) best = { id: h.id, count: h.count };
  }
  return best?.id ?? HALL_IDS[0] ?? "hall-01";
}

export async function fetchRooms(
  base: string,
  signal?: AbortSignal,
): Promise<RoomsResponse | null> {
  try {
    const res = await fetch(`${base}/api/rooms`, signal ? { signal } : {});
    if (!res.ok) return null;
    const body = (await res.json()) as RoomsResponse;
    return Array.isArray(body.halls) ? body : null;
  } catch {
    return null;
  }
}
