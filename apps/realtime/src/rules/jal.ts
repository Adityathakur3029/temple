/**
 * The jal offering (spec 03 § Offer water, bel patra or a flower): one queue for the whole
 * sanctum, so one visitor at a time walks in, offers on the linga and walks out. The visitor asks
 * from the nearer jal spot at the threshold; that side picks the bench and the sanctum lane the
 * avatar uses. First come first served, with a turn timeout before the offering and an exit time
 * after it. Pure data and functions, so tests can drive it without a socket; the RoomDO stores it
 * under `queues` and sends the messages.
 */
import {
  CHARANAMRIT_WINDOW_MS,
  JAL_COOLDOWN_MS,
  JAL_EXIT_MS,
  JAL_KINDS,
  JAL_NEAR_M,
  JAL_SPOT_REACH_M,
  JAL_TURN_TIMEOUT_MS,
  SANCTUM_LANES,
  SANCTUM_SPOTS,
  distance,
  jalDistance,
  type JalKind,
  type JalRefusal,
  type Point,
  type Rect,
  type VisitorId,
} from "@sannidhi/protocol";

/** The server allows 1 m more than the client's distance for asking and for charanamrit. */
export const JAL_SERVER_NEAR_M = JAL_NEAR_M + 1;

export interface JalEntry {
  id: VisitorId;
  req: number;
  kind: JalKind;
  /** The side asked from, 0 north or 1 south: the bench and sanctum lane the avatar uses. */
  side: number;
}

export interface JalTurn extends JalEntry {
  /** Server ms by which the offering must be done, or (once offered) the visitor out. */
  until: number;
  /** True once `jal.done` was accepted: the visitor is walking out. */
  offered?: boolean;
}

/** Stored as `queues.jal`. Small: one turn and at most one entry per visitor. */
export interface JalState {
  turn: JalTurn | null;
  queue: JalEntry[];
}

export const emptyJal = (): JalState => ({ turn: null, queue: [] });

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

const isEntry = (x: unknown): x is JalEntry =>
  isRecord(x) &&
  typeof x.id === "string" &&
  Number.isInteger(x.req) &&
  (JAL_KINDS as readonly unknown[]).includes(x.kind) &&
  (x.side === 0 || x.side === 1);

const isTurn = (x: unknown): x is JalTurn =>
  isEntry(x) &&
  Number.isFinite((x as unknown as Record<string, unknown>).until) &&
  [undefined, true, false].includes((x as unknown as Record<string, unknown>).offered as boolean);

/**
 * Reads the stored queue back. Anything else (the older two-sided shape, or a damaged value)
 * starts empty: nothing read from storage is trusted without checking its shape.
 */
export function loadJal(stored: unknown): JalState {
  if (
    isRecord(stored) &&
    (stored.turn === null || isTurn(stored.turn)) &&
    Array.isArray(stored.queue) &&
    stored.queue.every(isEntry)
  ) {
    return { turn: stored.turn, queue: stored.queue };
  }
  return emptyJal();
}

/** True if the visitor holds the turn or waits in the queue. */
export function inJal(s: JalState, id: VisitorId): boolean {
  return s.turn?.id === id || s.queue.some((q) => q.id === id);
}

/** The sanctum lane the visitor may walk on: their side's, while they hold the turn. */
export function laneOf(s: JalState, id: VisitorId): Rect | null {
  const t = s.turn;
  return t && t.id === id ? (SANCTUM_LANES[t.side] ?? null) : null;
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
 * A visitor asks for a turn from one side's jal spot (0 north, 1 south). Mutates the state when
 * the request is granted or queued. A visitor waits or offers once at a time.
 */
export function requestJal(
  s: JalState,
  e: JalEntry,
  at: Point,
  mem: OfferMemory,
  now: number,
): RequestResult {
  if (mem.offeredAt !== undefined && now - mem.offeredAt < JAL_COOLDOWN_MS) {
    return { ok: false, why: "cooldown" };
  }
  if (e.side !== 0 && e.side !== 1) return { ok: false, why: "not-near" };
  if (jalDistance(at, e.side) > JAL_SERVER_NEAR_M) return { ok: false, why: "not-near" };
  if (inJal(s, e.id)) return { ok: false, why: "busy" };
  if (!s.turn && s.queue.length === 0) {
    s.turn = { ...e, until: now + JAL_TURN_TIMEOUT_MS };
    return { ok: true, turn: s.turn };
  }
  s.queue.push(e);
  return { ok: true, queued: s.queue.length - 1 };
}

/**
 * True if `jal.done {req}` from `id` at `at` makes the offering: they hold the turn, haven't
 * offered yet, are in time, and stand at their side's sanctum spot.
 */
export function canFinish(
  s: JalState,
  id: VisitorId,
  req: number,
  at: Point,
  now: number,
): boolean {
  const t = s.turn;
  const spot = t ? SANCTUM_SPOTS[t.side] : undefined;
  return (
    t !== null &&
    spot !== undefined &&
    t.id === id &&
    t.req === req &&
    t.offered !== true &&
    now <= t.until &&
    distance(at, spot) <= JAL_SPOT_REACH_M
  );
}

/** The offering was made: the turn stays, for JAL_EXIT_MS, while the visitor walks out. */
export function markOffered(s: JalState, now: number): void {
  if (!s.turn) return;
  s.turn.offered = true;
  s.turn.until = now + JAL_EXIT_MS;
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

/** Removes a visitor from the queue or the turn. Returns the turn if they held it, else null. */
export function removeVisitor(s: JalState, id: VisitorId): JalTurn | null {
  s.queue = s.queue.filter((q) => q.id !== id);
  const t = s.turn;
  if (t?.id !== id) return null;
  s.turn = null;
  return t;
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
