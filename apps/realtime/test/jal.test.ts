import { describe, expect, it } from "vitest";
import {
  CHARANAMRIT_WINDOW_MS,
  JAL_COOLDOWN_MS,
  JAL_SPOT,
  JAL_SPOTS,
  JAL_TURN_TIMEOUT_MS,
} from "@sannidhi/protocol";
import {
  advance,
  canFinish,
  emptyJalSides,
  loadJalSides,
  sideOf,
  mayReceiveCharanamrit,
  offeringEvent,
  removeVisitor,
  requestJal,
} from "../src/rules/jal";

const AT = { x: JAL_SPOT.x, z: JAL_SPOT.z };
const FAR = { x: JAL_SPOT.x, z: JAL_SPOT.z + 6 };

describe("jal spot queue (spec 03 § Offer water, bel patra or a flower)", () => {
  it("gives the free spot at once, queues the next, and refuses a second request", () => {
    const sides = emptyJalSides();
    const a = requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, AT, {}, 1000);
    expect(a).toEqual({
      ok: true,
      turn: { id: "a", req: 1, kind: "water", until: 1000 + JAL_TURN_TIMEOUT_MS },
    });
    expect(requestJal(sides, 0, { id: "b", req: 1, kind: "flower" }, AT, {}, 1000)).toEqual({
      ok: true,
      queued: 0,
    });
    expect(requestJal(sides, 0, { id: "c", req: 1, kind: "bilva" }, AT, {}, 1000)).toEqual({
      ok: true,
      queued: 1,
    });
    expect(requestJal(sides, 0, { id: "b", req: 2, kind: "water" }, AT, {}, 1000)).toEqual({
      ok: false,
      why: "busy",
    });
    expect(requestJal(sides, 0, { id: "a", req: 2, kind: "water" }, AT, {}, 1000)).toEqual({
      ok: false,
      why: "busy",
    });
  });

  it("refuses from too far away, and within the cooldown", () => {
    const sides = emptyJalSides();
    expect(requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, FAR, {}, 0)).toEqual({
      ok: false,
      why: "not-near",
    });
    const mem = { offeredAt: 10_000 };
    expect(
      requestJal(
        sides,
        0,
        { id: "a", req: 1, kind: "water" },
        AT,
        mem,
        10_000 + JAL_COOLDOWN_MS - 1,
      ),
    ).toEqual({
      ok: false,
      why: "cooldown",
    });
    expect(
      requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, AT, mem, 10_000 + JAL_COOLDOWN_MS)
        .ok,
    ).toBe(true);
  });

  it("finishes only for the holder, with the same req, at the spot and in time", () => {
    const sides = emptyJalSides();
    const s = sides[0];
    requestJal(sides, 0, { id: "a", req: 7, kind: "water" }, AT, {}, 0);
    expect(canFinish(s, 0, "a", 7, AT, 100)).toBe(true);
    expect(canFinish(s, 0, "b", 7, AT, 100)).toBe(false);
    expect(canFinish(s, 0, "a", 8, AT, 100)).toBe(false);
    expect(canFinish(s, 0, "a", 7, { x: AT.x, z: AT.z + 1.5 }, 100)).toBe(false);
    expect(canFinish(s, 0, "a", 7, AT, JAL_TURN_TIMEOUT_MS + 1)).toBe(false);
  });

  it("passes the turn in order, skipping visitors who are gone", () => {
    const sides = emptyJalSides();
    const s = sides[0];
    requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, AT, {}, 0);
    requestJal(sides, 0, { id: "b", req: 1, kind: "water" }, AT, {}, 0);
    requestJal(sides, 0, { id: "c", req: 1, kind: "bilva" }, AT, {}, 0);
    const next = advance(s, (id) => id !== "b", 500);
    expect(next).toEqual({ id: "c", req: 1, kind: "bilva", until: 500 + JAL_TURN_TIMEOUT_MS });
    expect(s.queue).toEqual([]);
    expect(advance(s, () => true, 600)).toBeNull();
    expect(s.turn).toBeNull();
  });

  it("removes a visitor from the queue or the turn", () => {
    const sides = emptyJalSides();
    const s = sides[0];
    requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, AT, {}, 0);
    requestJal(sides, 0, { id: "b", req: 1, kind: "water" }, AT, {}, 0);
    expect(removeVisitor(s, "b")).toBe(false);
    expect(s.queue).toEqual([]);
    expect(removeVisitor(s, "a")).toBe(true);
    expect(s.turn).toBeNull();
  });

  it("allows charanamrit once, near the spot, within the window after one's own offering", () => {
    expect(mayReceiveCharanamrit({}, AT, 0)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, AT, CHARANAMRIT_WINDOW_MS)).toBe(true);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, AT, CHARANAMRIT_WINDOW_MS + 1)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0, charanamrit: true }, AT, 10)).toBe(false);
    expect(mayReceiveCharanamrit({ offeredAt: 0 }, FAR, 10)).toBe(false);
  });

  it("gives each side its own turn, one side per visitor", () => {
    const sides = emptyJalSides();
    const south = JAL_SPOTS[1] ?? JAL_SPOT;
    const AT_S = { x: south.x, z: south.z };
    expect("turn" in requestJal(sides, 0, { id: "a", req: 1, kind: "water" }, AT, {}, 0)).toBe(
      true,
    );
    // Someone at the south spot gets it at once while the north one is in use.
    expect("turn" in requestJal(sides, 1, { id: "b", req: 1, kind: "bilva" }, AT_S, {}, 0)).toBe(
      true,
    );
    expect(sideOf(sides, "a")).toBe(0);
    expect(sideOf(sides, "b")).toBe(1);
    expect(sideOf(sides, "c")).toBe(-1);
    // Already waiting or offering on one side: refused on the other.
    expect(requestJal(sides, 1, { id: "a", req: 2, kind: "water" }, AT_S, {}, 0)).toEqual({
      ok: false,
      why: "busy",
    });
    // The south spot is asked for from the south side only (the two are 3.8 m apart).
    expect(requestJal(sides, 1, { id: "c", req: 1, kind: "water" }, FAR, {}, 0)).toEqual({
      ok: false,
      why: "not-near",
    });
    expect(canFinish(sides[1], 1, "b", 1, AT_S, 10)).toBe(true);
    expect(canFinish(sides[1], 1, "b", 1, AT, 10)).toBe(false);
  });

  it("starts empty from stored queues of another shape", () => {
    expect(loadJalSides({ turn: null, queue: [] })).toEqual(emptyJalSides());
    expect(loadJalSides(undefined)).toEqual(emptyJalSides());
    const kept = emptyJalSides();
    kept[1].queue.push({ id: "a", req: 1, kind: "water" });
    expect(loadJalSides(kept)).toEqual(kept);
  });

  it("does not trust stored entries or turns of the wrong shape", () => {
    const bad = (side: unknown): unknown => [{ turn: null, queue: [] }, side];
    const empty = emptyJalSides();
    expect(loadJalSides(bad({ turn: null, queue: [{ id: 1, req: 1, kind: "water" }] }))).toEqual(
      empty,
    );
    expect(
      loadJalSides(bad({ turn: null, queue: [{ id: "a", req: 1.5, kind: "water" }] })),
    ).toEqual(empty);
    expect(loadJalSides(bad({ turn: null, queue: [{ id: "a", req: 1, kind: "milk" }] }))).toEqual(
      empty,
    );
    expect(loadJalSides(bad({ turn: { id: "a", req: 1, kind: "water" }, queue: [] }))).toEqual(
      empty,
    );
    expect(
      loadJalSides(bad({ turn: { id: "a", req: 1, kind: "water", until: "soon" }, queue: [] })),
    ).toEqual(empty);
    const turn = { id: "a", req: 1, kind: "water" as const, until: 5 };
    expect(loadJalSides(bad({ turn, queue: [] }))).toEqual([
      { turn: null, queue: [] },
      { turn, queue: [] },
    ]);
  });

  it("names water 'jal' for others, and the leaf and flower as they are", () => {
    expect(offeringEvent("water")).toBe("jal");
    expect(offeringEvent("bilva")).toBe("bilva");
    expect(offeringEvent("flower")).toBe("flower");
  });
});
