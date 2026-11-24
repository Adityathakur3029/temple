import { describe, expect, it } from "vitest";
import {
  CHARANAMRIT_WINDOW_MS,
  JAL_COOLDOWN_MS,
  JAL_EXIT_MS,
  JAL_SPOT,
  JAL_SPOTS,
  JAL_TURN_TIMEOUT_MS,
  SANCTUM_LANES,
  SANCTUM_SPOTS,
} from "@sannidhi/protocol";
import {
  advance,
  canFinish,
  emptyJal,
  inJal,
  laneOf,
  loadJal,
  markOffered,
  mayReceiveCharanamrit,
  offeringEvent,
  removeVisitor,
  requestJal,
} from "../src/rules/jal";

const AT = { x: JAL_SPOT.x, z: JAL_SPOT.z };
const SOUTH = JAL_SPOTS[1] ?? JAL_SPOT;
const AT_S = { x: SOUTH.x, z: SOUTH.z };
const FAR = { x: JAL_SPOT.x, z: JAL_SPOT.z + 6 };
const IN_N = SANCTUM_SPOTS[0] ?? { x: 0.68, z: 0.55 };
const IN_S = SANCTUM_SPOTS[1] ?? { x: -0.68, z: 0.55 };

describe("jal queue (spec 03 § Offer water, bel patra or a flower)", () => {
  it("gives the free turn at once, queues the next, and refuses a second request", () => {
    const s = emptyJal();
    const a = requestJal(s, { id: "a", req: 1, kind: "water", side: 0 }, AT, {}, 1000);
    expect(a).toEqual({
      ok: true,
      turn: { id: "a", req: 1, kind: "water", side: 0, until: 1000 + JAL_TURN_TIMEOUT_MS },
    });
    expect(requestJal(s, { id: "b", req: 1, kind: "flower", side: 0 }, AT, {}, 1000)).toEqual({
      ok: true,
      queued: 0,
    });
    expect(requestJal(s, { id: "c", req: 1, kind: "bilva", side: 0 }, AT, {}, 1000)).toEqual({
      ok: true,
      queued: 1,
    });
    expect(requestJal(s, { id: "b", req: 2, kind: "water", side: 0 }, AT, {}, 1000)).toEqual({
      ok: false,
      why: "busy",
    });
    expect(requestJal(s, { id: "a", req: 2, kind: "water", side: 0 }, AT, {}, 1000)).toEqual({
      ok: false,
      why: "busy",
    });
  });

  it("keeps one queue for both sides: someone at the south spot waits for the north turn", () => {
    const s = emptyJal();
    expect("turn" in requestJal(s, { id: "a", req: 1, kind: "water", side: 0 }, AT, {}, 0)).toBe(
      true,
    );
    expect(requestJal(s, { id: "b", req: 1, kind: "bilva", side: 1 }, AT_S, {}, 0)).toEqual({
      ok: true,
      queued: 0,
    });
    // Already waiting: refused from the other side too.
    expect(requestJal(s, { id: "b", req: 2, kind: "water", side: 0 }, AT, {}, 0)).toEqual({
      ok: false,
      why: "busy",
    });
    // Each side is asked for from near its own spot (the two are 3.8 m apart).
    expect(requestJal(s, { id: "c", req: 1, kind: "water", side: 1 }, FAR, {}, 0)).toEqual({
      ok: false,
      why: "not-near",
    });
    expect(requestJal(s, { id: "c", req: 1, kind: "water", side: 2 }, AT, {}, 0)).toEqual({
      ok: false,
      why: "not-near",
    });
    expect(inJal(s, "a")).toBe(true);
    expect(inJal(s, "b")).toBe(true);
    expect(inJal(s, "c")).toBe(false);
  });

  it("refuses from too far away, and within the cooldown", () => {
    const s = emptyJal();
    expect(requestJal(s, { id: "a", req: 1, kind: "water", side: 0 }, FAR, {}, 0)).toEqual({
      ok: false,
      why: "not-near",
    });
    const mem = { offeredAt: 10_000 };
    const e = { id: "a", req: 1, kind: "water" as const, side: 0 };
    expect(requestJal(s, e, AT, mem, 10_000 + JAL_COOLDOWN_MS - 1)).toEqual({
      ok: false,
      why: "cooldown",
    });
    expect(requestJal(s, e, AT, mem, 10_000 + JAL_COOLDOWN_MS).ok).toBe(true);
  });

  it("opens only the holder's side's lane, and only while they hold the turn", () => {
    const s = emptyJal();
    requestJal(s, { id: "a", req: 1, kind: "water", side: 1 }, AT_S, {}, 0);
    requestJal(s, { id: "b", req: 1, kind: "water", side: 0 }, AT, {}, 0);
    expect(laneOf(s, "a")).toEqual(SANCTUM_LANES[1]);
    expect(laneOf(s, "b")).toBeNull();
    expect(laneOf(s, "c")).toBeNull();
    removeVisitor(s, "a");
    expect(laneOf(s, "a")).toBeNull();
  });

  it("offers only for the holder, with the same req, at their sanctum spot, in time, once", () => {
    const s = emptyJal();
    requestJal(s, { id: "a", req: 7, kind: "water", side: 0 }, AT, {}, 0);
    expect(canFinish(s, "a", 7, IN_N, 100)).toBe(true);
    expect(canFinish(s, "b", 7, IN_N, 100)).toBe(false);
    expect(canFinish(s, "a", 8, IN_N, 100)).toBe(false);
    // At the threshold, or at the other side's spot, is not inside on their lane.
    expect(canFinish(s, "a", 7, AT, 100)).toBe(false);
    expect(canFinish(s, "a", 7, IN_S, 100)).toBe(false);
    expect(canFinish(s, "a", 7, IN_N, JAL_TURN_TIMEOUT_MS + 1)).toBe(false);
    markOffered(s, 200);
    expect(s.turn).toMatchObject({ id: "a", offered: true, until: 200 + JAL_EXIT_MS });
    expect(canFinish(s, "a", 7, IN_N, 300)).toBe(false);
  });

  it("passes the turn in order, skipping visitors who are gone", () => {
    const s = emptyJal();
    requestJal(s, { id: "a", req: 1, kind: "water", side: 0 }, AT, {}, 0);
    requestJal(s, { id: "b", req: 1, kind: "water", side: 0 }, AT, {}, 0);
    requestJal(s, { id: "c", req: 1, kind: "bilva", side: 1 }, AT_S, {}, 0);
    const next = advance(s, (id) => id !== "b", 500);
    expect(next).toEqual({
      id: "c",
      req: 1,
      kind: "bilva",
      side: 1,
      until: 500 + JAL_TURN_TIMEOUT_MS,
    });
    expect(s.queue).toEqual([]);
    expect(advance(s, () => true, 600)).toBeNull();
    expect(s.turn).toBeNull();
  });

  it("removes a visitor from the queue or the turn", () => {
    const s = emptyJal();
    requestJal(s, { id: "a", req: 1, kind: "water", side: 0 }, AT, {}, 0);
    requestJal(s, { id: "b", req: 1, kind: "water", side: 0 }, AT, {}, 0);
    expect(removeVisitor(s, "b")).toBeNull();
    expect(s.queue).toEqual([]);
    expect(removeVisitor(s, "a")).toMatchObject({ id: "a", side: 0 });
    expect(s.turn).toBeNull();
  });

  it("allows charanamrit once, near the spot, within the window after one's own offering", () => {
    expect(mayReceiveCharanamrit({}, AT, 0)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, AT, CHARANAMRIT_WINDOW_MS)).toBe(true);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, AT, CHARANAMRIT_WINDOW_MS + 1)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0, charanamrit: true }, AT, 10)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, FAR, 10)).toBe(false);
  });

  it("starts empty from stored queues of another shape (the older two-sided one too)", () => {
    expect(loadJal(undefined)).toEqual(emptyJal());
    expect(
      loadJal([
        { turn: null, queue: [] },
        { turn: null, queue: [] },
      ]),
    ).toEqual(emptyJal());
    const kept = emptyJal();
    kept.queue.push({ id: "a", req: 1, kind: "water", side: 1 });
    kept.turn = { id: "b", req: 2, kind: "flower", side: 0, until: 5, offered: true };
    expect(loadJal(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  it("does not trust stored entries or turns of the wrong shape", () => {
    const empty = emptyJal();
    const q = (entry: unknown): unknown => ({ turn: null, queue: [entry] });
    expect(loadJal(q({ id: 1, req: 1, kind: "water", side: 0 }))).toEqual(empty);
    expect(loadJal(q({ id: "a", req: 1.5, kind: "water", side: 0 }))).toEqual(empty);
    expect(loadJal(q({ id: "a", req: 1, kind: "milk", side: 0 }))).toEqual(empty);
    expect(loadJal(q({ id: "a", req: 1, kind: "water" }))).toEqual(empty);
    expect(loadJal(q({ id: "a", req: 1, kind: "water", side: 3 }))).toEqual(empty);
    expect(loadJal({ turn: { id: "a", req: 1, kind: "water", side: 0 }, queue: [] })).toEqual(
      empty,
    );
    expect(
      loadJal({ turn: { id: "a", req: 1, kind: "water", side: 0, until: "soon" }, queue: [] }),
    ).toEqual(empty);
    expect(
      loadJal({
        turn: { id: "a", req: 1, kind: "water", side: 0, until: 5, offered: "yes" },
        queue: [],
      }),
    ).toEqual(empty);
  });

  it("names water 'jal' for others, and the leaf and flower as they are", () => {
    expect(offeringEvent("water")).toBe("jal");
    expect(offeringEvent("bilva")).toBe("bilva");
    expect(offeringEvent("flower")).toBe("flower");
  });
});
