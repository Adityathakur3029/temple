import { DurableObject } from "cloudflare:workers";
import {
  HALL_IDS,
  INSTANCE_CAPACITY,
  INSTANCES_PER_HALL,
  PROTOCOL_VERSION,
  istDate,
  type HallId,
  type RoomsResponse,
  type TodayCounters,
} from "@sannidhi/protocol";

/** A report older than this counts as an empty instance (spec 05 § DirectoryDO). */
export const REPORT_STALE_MS = 90_000;
/** Each pick holds a place this long, until the RoomDO's own report catches up. */
export const RESERVATION_MS = 10_000;
/**
 * A pick made this long before a RoomDO's report has joined by then, so the report counts it and
 * the reservation can go. Without this, recent joins count twice and an instance looks full early.
 */
export const JOIN_IN_FLIGHT_MS = 1000;
/** `pick` needs at least this many free places, so friends arriving together land together. */
export const PICK_MIN_FREE = 2;
/** Today counters are kept this many IST days, today included. */
export const COUNTER_DAYS = 7;

export type CounterName = Exclude<keyof TodayCounters, "date">;
/** Increments batched by a RoomDO, per IST date (a batch can span midnight). */
export type CounterBatch = Record<string, Partial<Record<CounterName, number>>>;

export type PickResult = { instance: number } | { full: true };

const COUNTER_NAMES: readonly CounterName[] = ["diyas", "malas", "parikramas", "visits"];

function emptyCounters(date: string): TodayCounters {
  return { date, diyas: 0, malas: 0, parikramas: 0, visits: 0 };
}

/** Whole days between two IST dates ("YYYY-MM-DD"). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The single "directory" object: instance counts per hall, instance choice and the temple-wide
 * today counters (spec 05 § DirectoryDO). Called over RPC by the Worker and the RoomDOs.
 *
 * The instance table and reservations live in memory: every open RoomDO reports at least every
 * 30 s, so after a restart the table is whole again within one report interval. Counters are
 * stored, one key per IST date (`today:2026-11-03`).
 */
export class DirectoryDO extends DurableObject<Env> {
  private readonly table = new Map<string, { count: number; reportedAt: number }>();
  /** When each pending pick was made, per instance. */
  private readonly reservations = new Map<string, number[]>();
  private today: TodayCounters | null = null;

  /** Visitors an instance can still take: capacity minus its fresh count and live reservations. */
  private free(hall: HallId, instance: number, now: number): number {
    const key = `${hall}#${instance}`;
    const row = this.table.get(key);
    const fresh = row !== undefined && now - row.reportedAt <= REPORT_STALE_MS;
    const count = fresh ? row.count : 0;
    const counted = fresh ? row.reportedAt - JOIN_IN_FLIGHT_MS : Number.NEGATIVE_INFINITY;
    const live = (this.reservations.get(key) ?? []).filter(
      (at) => now - at < RESERVATION_MS && at > counted,
    );
    this.reservations.set(key, live);
    return INSTANCE_CAPACITY - count - live.length;
  }

  /** The lowest instance with at least PICK_MIN_FREE places, holding one place for the caller. */
  pick(hall: HallId, now = Date.now()): PickResult {
    for (let i = 1; i <= INSTANCES_PER_HALL; i++) {
      if (this.free(hall, i, now) >= PICK_MIN_FREE) {
        const key = `${hall}#${i}`;
        this.reservations.set(key, [...(this.reservations.get(key) ?? []), now]);
        return { instance: i };
      }
    }
    return { full: true };
  }

  /**
   * A RoomDO's count: visitors connected plus places held for those who may resume (spec 05 §
   * Capacity). Returns today's counters so the room can push them.
   */
  async report(hall: HallId, instance: number, count: number): Promise<TodayCounters> {
    const now = Date.now();
    this.table.set(`${hall}#${instance}`, { count, reportedAt: now });
    return this.todayCounters(now);
  }

  /** Adds a RoomDO's batched counter increments. Returns today's counters. */
  async addCounters(batch: CounterBatch): Promise<TodayCounters> {
    const now = Date.now();
    const todayDate = istDate(now);
    for (const [date, inc] of Object.entries(batch)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const age = daysBetween(date, todayDate);
      if (age < 0 || age >= COUNTER_DAYS) continue;
      const row =
        date === todayDate
          ? await this.todayCounters(now)
          : ((await this.ctx.storage.get<TodayCounters>(`today:${date}`)) ?? emptyCounters(date));
      for (const name of COUNTER_NAMES) {
        const n = inc[name];
        if (typeof n === "number" && Number.isInteger(n) && n > 0) row[name] += n;
      }
      await this.ctx.storage.put(`today:${date}`, row);
    }
    return this.todayCounters(now);
  }

  /** Today's (IST) counters across all halls. */
  async todayCounters(now = Date.now()): Promise<TodayCounters> {
    const date = istDate(now);
    if (this.today?.date === date) return this.today;
    this.today =
      (await this.ctx.storage.get<TodayCounters>(`today:${date}`)) ?? emptyCounters(date);
    await this.dropOldCounters(date);
    return this.today;
  }

  /** The room list (spec 04 § Room list). */
  async rooms(): Promise<RoomsResponse> {
    const now = Date.now();
    const halls = HALL_IDS.map((id, i) => {
      let count = 0;
      let instances = 0;
      let checkedAt = 0;
      for (let n = 1; n <= INSTANCES_PER_HALL; n++) {
        const row = this.table.get(`${id}#${n}`);
        if (!row || now - row.reportedAt > REPORT_STALE_MS) continue;
        count += row.count;
        if (row.count > 0) instances++;
        checkedAt = Math.max(checkedAt, row.reportedAt);
      }
      return {
        id,
        number: i + 1,
        count,
        capacity: INSTANCE_CAPACITY * INSTANCES_PER_HALL,
        instances,
        // No recent report means nobody is there, as of now.
        checkedAt: checkedAt || now,
      };
    });
    return { v: PROTOCOL_VERSION, serverTime: now, halls, today: await this.todayCounters(now) };
  }

  /** Counters roll over at 00:00 IST; days beyond COUNTER_DAYS are deleted. */
  private async dropOldCounters(todayDate: string): Promise<void> {
    const old: string[] = [];
    for (const key of (await this.ctx.storage.list({ prefix: "today:" })).keys()) {
      if (daysBetween(key.slice("today:".length), todayDate) >= COUNTER_DAYS) old.push(key);
    }
    if (old.length > 0) await this.ctx.storage.delete(old);
  }
}
