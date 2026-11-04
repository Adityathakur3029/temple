import {
  HALL_IDS,
  INSTANCE_CAPACITY,
  INSTANCES_PER_HALL,
  PROTOCOL_VERSION,
  istDate,
  type HallId,
  type RoomsResponse,
} from "@sannidhi/protocol";

/**
 * Durable Object name for a hall instance, e.g. "hall-03#2". Instances are numbered
 * 1 … INSTANCES_PER_HALL. The range check matters once resume tokens (client input) name
 * an instance: an unchecked number would let anyone create arbitrary objects.
 */
export function roomName(hall: HallId, instance: number): string {
  if (!Number.isInteger(instance) || instance < 1 || instance > INSTANCES_PER_HALL) {
    throw new RangeError(`instance must be 1…${INSTANCES_PER_HALL}, got ${instance}`);
  }
  return `${hall}#${instance}`;
}

/**
 * M0: a static room list with every hall empty. In M2 this is built by the DirectoryDO
 * from reported instance counts and cached for 3 s (spec 05 § Routes).
 */
export function staticRooms(now: number): RoomsResponse {
  return {
    v: PROTOCOL_VERSION,
    serverTime: now,
    halls: HALL_IDS.map((id, i) => ({
      id,
      number: i + 1,
      count: 0,
      capacity: INSTANCE_CAPACITY * INSTANCES_PER_HALL,
      instances: 0,
      checkedAt: now,
    })),
    today: { date: istDate(now), diyas: 0, malas: 0, parikramas: 0, visits: 0 },
  };
}
