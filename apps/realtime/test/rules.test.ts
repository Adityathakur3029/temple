import { describe, expect, it } from "vitest";
import {
  BELL_MAX_PER_SEC,
  CHECKPOINTS,
  GESTURE_COOLDOWN_MS,
  MATS,
  NAME_KEYS,
  POS_MAX_HZ,
  STRIKE_LIMIT,
  isNameKey,
  parseResumeToken,
  type PosMessage,
} from "@sannidhi/protocol";
import { BellWindows, inBellReach } from "../src/rules/bells";
import { newResumeToken, newVisitor, newVisitorId } from "../src/rules/identity";
import { Buckets, STRIKE_WINDOW_MS, addStrike } from "../src/rules/limits";
import { nearestFreeMat } from "../src/rules/mats";
import { MOVE_SLACK_M, POSE, checkMove, isSeated, type Place } from "../src/rules/movement";

const at = (x: number, z: number, extra: Partial<Place> = {}): Place => ({
  x,
  z,
  yaw: 0,
  pose: POSE.stand,
  mat: -1,
  posAt: 0,
  firstPos: false,
  ...extra,
});
const pos = (x: number, z: number, pose: PosMessage["pose"] = "walk"): PosMessage => ({
  t: "pos",
  x,
  z,
  yaw: 0,
  pose,
});

describe("movement rule: no step ends on or crosses a sacred zone", () => {
  // From a walkable place next to each zone, one short step (well inside the speed limit) into it.
  const cases = [
    { zone: "garbhagriha", from: at(3.2, -1.5), to: { x: 2.4, z: -1.5 } },
    { zone: "garbhagriha (from the jal spot)", from: at(1.9, 3.4), to: { x: 1.9, z: 2.4 } },
    { zone: "nandi-axis (from the mandapa)", from: at(1.6, 12), to: { x: 1.1, z: 12 } },
    { zone: "nandi-axis (hopping across)", from: at(1.5, 15), to: { x: -1.5, z: 15 } },
    { zone: "kund-water", from: at(12.4, 32), to: { x: 13.4, z: 32 } },
    { zone: "somasutra (on it)", from: at(10.5, 0.6), to: { x: 10.5, z: 0 } },
    { zone: "somasutra (hopping across)", from: at(10.5, 0.5), to: { x: 10.5, z: -0.5 } },
  ];
  it.each(cases)("$zone", ({ from, to }) => {
    const v = checkMove(from, pos(to.x, to.z), 1000);
    expect(v.ok).toBe(false);
  });

  it("accepts an ordinary step and rounds it to 1 cm", () => {
    const v = checkMove(at(0, 30), pos(0.123456, 29.5), 400);
    expect(v).toEqual({
      ok: true,
      place: { x: 0.12, z: 29.5, yaw: 0, pose: POSE.walk, mat: -1, posAt: 400, firstPos: false },
    });
  });

  it("allows SPEED_LIMIT_MPS × dt plus slack, and no more", () => {
    const from = at(0, 30, { posAt: 0 });
    const dt = 1000 / POS_MAX_HZ; // 100 ms
    const allowed = 2.2 * (dt / 1000) + MOVE_SLACK_M;
    expect(checkMove(from, pos(0, 30 - allowed + 0.01), dt).ok).toBe(true);
    expect(checkMove(from, pos(0, 30 - allowed - 0.02), dt)).toEqual({ ok: false, why: "too-far" });
  });

  it("lets the first position after a fresh welcome be anywhere walkable, but not a zone", () => {
    const first = at(0, 56.5, { firstPos: true });
    expect(checkMove(first, pos(CHECKPOINTS.W.x, CHECKPOINTS.W.z), 1).ok).toBe(true);
    expect(checkMove(first, pos(0, 10), 1).ok).toBe(false); // the Nandi axis
    expect(checkMove(first, pos(0, 0), 1).ok).toBe(false); // the sanctum
    expect(checkMove(first, pos(40, 40), 1).ok).toBe(false); // outside
  });

  it("refuses non-finite or far-away input", () => {
    expect(checkMove(at(0, 30), pos(Number.NaN, 30), 100).ok).toBe(false);
    expect(checkMove(at(0, 30), pos(0, 1e9), 100).ok).toBe(false);
  });
});

describe("movement rule: poses", () => {
  const m = MATS[0];
  if (!m) throw new Error("no mats");

  it("allows sit only on the held mat, and places the visitor on it facing the sanctum", () => {
    expect(checkMove(at(m.x + 0.2, m.z), pos(m.x + 0.2, m.z, "sit"), 500)).toEqual({
      ok: false,
      why: "pose",
    });
    const v = checkMove(at(m.x + 0.2, m.z, { mat: 0 }), pos(m.x + 0.2, m.z, "sit"), 500);
    expect(v.ok && v.place).toMatchObject({ x: m.x, z: m.z, pose: POSE.sit, mat: 0 });
    expect(v.ok && v.place.yaw).toBeCloseTo(m.yaw, 2);
    expect(checkMove(at(m.x + 0.6, m.z, { mat: 0 }), pos(m.x + 0.6, m.z, "sit"), 500).ok).toBe(
      false,
    );
  });

  it("keeps a seated visitor on the mat until they stand", () => {
    const seated = at(m.x, m.z, { mat: 0, pose: POSE.sit, yaw: m.yaw });
    expect(isSeated(seated)).toBe(true);
    expect(checkMove(seated, pos(m.x + 1, m.z, "japa"), 2000)).toEqual({
      ok: false,
      why: "seated",
    });
    expect(checkMove(seated, pos(m.x + 1, m.z, "sit"), 2000).ok).toBe(false);
    expect(checkMove(seated, pos(m.x, m.z, "japa"), 2000).ok).toBe(true);
    // Any standing pose gets up and frees the mat.
    const up = checkMove(seated, pos(m.x, m.z + 0.3, "walk"), 2000);
    expect(up.ok && up.place.mat).toBe(-1);
  });

  it("refuses the offer pose until the diya and jal turns exist (M3)", () => {
    expect(checkMove(at(0, 30), pos(0, 30, "offer"), 100)).toEqual({ ok: false, why: "pose" });
  });
});

describe("rate limits and strikes", () => {
  it("takes tokens and refills them over time", () => {
    const b = new Buckets();
    expect(b.take("gesture", 0)).toBe(true);
    expect(b.take("gesture", GESTURE_COOLDOWN_MS - 1)).toBe(false);
    expect(b.take("gesture", GESTURE_COOLDOWN_MS * 2)).toBe(true);
    let n = 0;
    for (let i = 0; i < 30; i++) if (b.take("pos", 0)) n++;
    expect(n).toBe(20);
    expect(b.take("time", 0) && b.take("time", 1) && b.take("time", 2)).toBe(true);
    expect(b.take("leave", 0)).toBe(true);
    expect(b.take("leave", 1e12)).toBe(false);
  });

  it("closes only when strikes in the last 60 s exceed STRIKE_LIMIT", () => {
    const strikes: number[] = [];
    for (let i = 0; i < STRIKE_LIMIT; i++) expect(addStrike(strikes, i)).toBe(false);
    expect(addStrike(strikes, STRIKE_LIMIT)).toBe(true);
    const old: number[] = [];
    for (let i = 0; i < STRIKE_LIMIT; i++) addStrike(old, 0);
    expect(addStrike(old, STRIKE_WINDOW_MS + 1)).toBe(false);
    expect(old).toEqual([STRIKE_WINDOW_MS + 1]);
  });
});

describe("bells", () => {
  it("reaches BELL_REACH_M + 1 m", () => {
    expect(inBellReach({ x: 0, z: 55 }, "gate")).toBe(true);
    expect(inBellReach({ x: 0, z: 54.9 }, "gate")).toBe(false);
  });

  it("caps each bell at BELL_MAX_PER_SEC across visitors", () => {
    const w = new BellWindows();
    const rung = [0, 10, 20, 30].filter((t) => w.allow("gate", t)).length;
    expect(rung).toBe(BELL_MAX_PER_SEC);
    expect(w.allow("path-1", 30)).toBe(true);
    expect(w.allow("gate", 1001)).toBe(true);
  });
});

describe("identity", () => {
  it("makes short unique ids", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const id = newVisitorId(taken);
      expect(id).toMatch(/^[a-z][a-z0-9]+$/);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });

  it("names visitors from the curated list with a number unique in the instance", () => {
    const numbers = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const v = newVisitor(`v${i}`, numbers, 5);
      expect(isNameKey(v.name.key)).toBe(true);
      expect(v.name.n).toBeGreaterThanOrEqual(100);
      expect(v.name.n).toBeLessThanOrEqual(999);
      expect(numbers.has(v.name.n)).toBe(false);
      numbers.add(v.name.n);
      expect([0, 1]).toContain(v.body);
    }
    // With a fixed draw the number moves on to the next free one.
    const v = newVisitor("x", new Set([100, 101]), 0, () => 0);
    expect(v).toEqual({
      id: "x",
      name: { key: NAME_KEYS[0], n: 102 },
      shawl: 0,
      body: 0,
      joinedAt: 0,
    });
  });

  it("makes resume tokens the protocol can parse", () => {
    const t = newResumeToken("hall-07", 3);
    expect(parseResumeToken(t)).toEqual({ hall: "hall-07", instance: 3 });
    expect(newResumeToken("hall-07", 3)).not.toBe(t);
  });
});

describe("mats", () => {
  it("picks the nearest free mat", () => {
    const m5 = MATS[5];
    if (!m5) throw new Error("no mat 5");
    expect(nearestFreeMat(m5, new Set())).toBe(5);
    expect(nearestFreeMat(m5, new Set([5]))).not.toBe(5);
    expect(nearestFreeMat(m5, new Set(MATS.map((_, i) => i)))).toBe(-1);
  });
});
