import { INSTANCES_PER_HALL, type HallId } from "@sannidhi/protocol";

/**
 * Durable Object name for a hall instance, e.g. "hall-03#2". Instances are numbered
 * 1 … INSTANCES_PER_HALL. The range check matters because resume tokens (client input) name
 * an instance: an unchecked number would let anyone create arbitrary objects.
 */
export function roomName(hall: HallId, instance: number): string {
  if (!Number.isInteger(instance) || instance < 1 || instance > INSTANCES_PER_HALL) {
    throw new RangeError(`instance must be 1…${INSTANCES_PER_HALL}, got ${instance}`);
  }
  return `${hall}#${instance}`;
}

/** The room list is kept this long, to protect the single DirectoryDO from bursts (spec 05). */
export const ROOMS_CACHE_MS = 3000;

/**
 * Per isolate. The Cache API does nothing on workers.dev hosts, where staging runs, so the list
 * is held in memory instead, and each isolate asks the DirectoryDO at most every 3 s. (It lives
 * here because the Worker's main module may only export handlers and Durable Object classes.)
 */
export const roomsCache: { at: number; body: string | null } = { at: 0, body: null };

/** For tests: forget the cached room list. */
export function clearRoomsCache(): void {
  roomsCache.body = null;
}
