/**
 * The jal spots at the threshold, one each side of the door, each with its own turn and queue (spec 03 § Offer water, bel patra or a flower): one visitor at a
 * time, first come first served, with a turn timeout. Pure data and functions, so tests can
 * drive it without a socket; the RoomDO stores it under `queues` and sends the messages.
 */
import {
  CHARANAMRIT_WINDOW_MS,
  JAL_COOLDOWN_MS,
  JAL_KINDS,
  JAL_NEAR_M,
  JAL_SPOT_REACH_M,
  JAL_TURN_TIMEOUT_MS,
  jalDistance,
  type JalKind,
  type JalRefusal,
  type Point,
  type VisitorId,
} from "@sannidhi/protocol";

/** The server allows 1 m more than the client's distance for asking and for charanamrit. */
export const JAL_SERVER_NEAR_M = JAL_NEAR_M + 1;

export interface JalEntry {
  id: VisitorId;
  req: number;
  kind: JalKind;
}

export interface JalTurn extends JalEntry {
  /** Server ms by which the offering must be done. */
  until: number;
}

/** Stored as `queues.jal`. Small: one turn and at most one entry per visitor. */
export interface JalState {
  turn: JalTurn | null;
  queue: JalEntry[];
}

export const emptyJal = (): JalState => ({ turn: null, queue: [] });

/** Both sides' turns and queues, in the order of JAL_SIDES (north, south). Stored as `queues.jal`. */
export type JalSides = [JalState, JalState];

export const emptyJalSides = (): JalSides => [emptyJal(), emptyJal()];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

const isEntry = (x: unknown): x is JalEntry =>
  isRecord(x) &&
  typeof x.id === "string" &&
  Number.isInteger(x.req) &&
  (JAL_KINDS as readonly unknown[]).includes(x.kind);

const isTurn = (x: unknown): x is JalTurn =>
  isEntry(x) && Number.isFinite((x as unknown as Record<string, unknown>).until);

const isState = (x: unknown): x is JalState =>
  isRecord(x) &&
  (x.turn === null || isTurn(x.turn)) &&
  Array.isArray(x.queue) &&
  x.queue.every(isEntry);

/**
 * Reads stored sides back. Anything else (an older single spot, or a damaged value) starts empty:
 * nothing read from storage is trusted without checking its shape.
 */
export function loadJalSides(stored: unknown): JalSides {
  if (!Array.isArray(stored) || stored.length !== 2) return emptyJalSides();
  const [n, so] = stored as unknown[];
  return isState(n) && isState(so) ? [n, so] : emptyJalSides();
}

/** The side (0 north, 1 south) where a visitor holds the turn or waits, or -1. */
export function sideOf(sides: JalSides, id: VisitorId): number {
  return sides.findIndex((s) => s.turn?.id === id || s.queue.some((q) => q.id === id));
}

/** What a visitor's last offering allows (kept on their attachment). */
export interface OfferMemory {
  /** Server ms of the visitor's last completed offering. */
  offeredAt?: number;
  /** True once charanamrit was received for that offering. */
  charanamrit?: boolean;
}

export type RequestResult =
  { ok: true; turn: JalTurn } | { ok: true; queued: number } | { ok: false; why: JalRefusal };

/**
 * A visitor asks for one side's spot (0 north, 1 south). Mutates that side when the request is
 * granted or queued. A visitor waits or offers at one side at a time.
 */
export function requestJal(
  sides: JalSides,
  side: number,
  e: JalEntry,
  at: Point,
  mem: OfferMemory,
  now: number,
): RequestResult {
  if (mem.offeredAt !== undefined && now - mem.offeredAt < JAL_COOLDOWN_MS) {
    return { ok: false, why: "cooldown" };
  }
  if (jalDistance(at, side) > JAL_SERVER_NEAR_M) return { ok: false, why: "not-near" };
  if (sideOf(sides, e.id) >= 0) return { ok: false, why: "busy" };
  const s = sides[side];
  if (!s) return { ok: false, why: "not-near" };
  if (!s.turn && s.queue.length === 0) {
    s.turn = { ...e, until: now + JAL_TURN_TIMEOUT_MS };
    return { ok: true, turn: s.turn };
  }
  s.queue.push(e);
  return { ok: true, queued: s.queue.length - 1 };
}

/** True if `jal.done {req}` from `id` at `at` finishes the current turn on that side. */
export function canFinish(
  s: JalState,
  side: number,
  id: VisitorId,
  req: number,
  at: Point,
  now: number,
): boolean {
  const t = s.turn;
  return (
    t !== null &&
    t.id === id &&
    t.req === req &&
    now <= t.until &&
    jalDistance(at, side) <= JAL_SPOT_REACH_M
  );
}

/**
 * Gives the turn to the first queued visitor who may still come (`present`): connected, or
 * holding a resume place. Others are dropped. Returns the new turn, or null if none is waiting.
 */
export function advance(
  s: JalState,
  present: (id: VisitorId) => boolean,
  now: number,
): JalTurn | null {
  s.turn = null;
  while (s.queue.length > 0) {
    const next = s.queue.shift();
    if (next && present(next.id)) {
      s.turn = { ...next, until: now + JAL_TURN_TIMEOUT_MS };
      return s.turn;
    }
  }
  return null;
}

/** Removes a visitor from the queue or the turn. Returns true if they held the turn. */
export function removeVisitor(s: JalState, id: VisitorId): boolean {
  s.queue = s.queue.filter((q) => q.id !== id);
  if (s.turn?.id !== id) return false;
  s.turn = null;
  return true;
}

/** Charanamrit (spec 03 § Receive charanamrit): after one's own offering, once, near the spot. */
export function mayReceiveCharanamrit(mem: OfferMemory, at: Point, now: number): boolean {
  return (
    mem.offeredAt !== undefined &&
    now - mem.offeredAt <= CHARANAMRIT_WINDOW_MS &&
    mem.charanamrit !== true &&
    jalDistance(at) <= JAL_SERVER_NEAR_M
  );
}

/** The event kind others see for an offering. */
export function offeringEvent(kind: JalKind): "jal" | "bilva" | "flower" {
  return kind === "water" ? "jal" : kind;
}
