import { describe, expect, it } from "vitest";
import {
  JAL_SPOT,
  MATS,
  SPAWN,
  SPEED_LIMIT_MPS,
  WALK_SPEED_MPS,
  inSacredZone,
  isWalkable,
  type Spot,
} from "@sannidhi/protocol";
import { NavGrid } from "../src/scene/nav";
import { Walker } from "../src/scene/walker";

/** A small seeded random source, so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const starts: [string, Spot][] = [
  ["the gate", SPAWN],
  ["the jal spot beside the door", JAL_SPOT],
  ["the mats next to the aisle", MATS[0] ?? SPAWN],
  ["the path before the somasutra", { x: 10.5, z: -1.5, yaw: 0 }],
  ["the kund rim", { x: 11.6, z: 32, yaw: Math.PI / 2 }],
  ["beside Nandi", { x: 1.6, z: 22, yaw: 0 }],
];

describe("keyboard walking can't reach a sacred or blocked zone (spec 02 § Acceptance)", () => {
  it.each(starts)("random walking from %s", (_name, start) => {
    const w = new Walker(start);
    const r = rng(7);
    let dir = { x: 0, z: 0 };
    for (let i = 0; i < 4000; i++) {
      if (i % 25 === 0) {
        const a = r() * Math.PI * 2;
        dir = { x: Math.sin(a), z: Math.cos(a) };
      }
      w.update(1 / 30, dir);
      expect(isWalkable(w.x, w.z), `step ${i} at (${w.x}, ${w.z})`).toBe(true);
    }
  });

  it.each([
    ["into the sanctum door from the threshold", JAL_SPOT, { x: -0.6, z: -0.8 }],
    ["across the aisle from the mats", MATS[0] ?? SPAWN, { x: -1, z: 0 }],
    ["into the kund", { x: 11.6, z: 32, yaw: 0 }, { x: 1, z: 0 }],
    ["over the somasutra", { x: 10.5, z: -1.5, yaw: 0 }, { x: 0, z: 1 }],
    ["into Nandi", { x: 0, z: 24, yaw: Math.PI }, { x: 0, z: -1 }],
  ])("holding a key %s", (_name, start, dir) => {
    const w = new Walker(start);
    for (let i = 0; i < 300; i++) {
      w.update(1 / 30, dir);
      expect(inSacredZone(w.x, w.z)).toBe(false);
      expect(isWalkable(w.x, w.z)).toBe(true);
    }
  });

  it("stays safe with huge frame times (a paused tab, or a test time scale)", () => {
    const w = new Walker(JAL_SPOT);
    for (let i = 0; i < 20; i++) {
      w.update(2, { x: -1, z: -1 });
      expect(isWalkable(w.x, w.z)).toBe(true);
    }
  });

  it("slides along a wall instead of stopping dead", () => {
    const w = new Walker({ x: 2, z: 10, yaw: 0 });
    w.update(1, { x: -1, z: 1 }); // diagonally into the aisle
    expect(w.z).toBeGreaterThan(10.5);
    expect(inSacredZone(w.x, w.z)).toBe(false);
  });
});

describe("walking pace", () => {
  it("is WALK_SPEED_MPS, well inside the server's limit", () => {
    const w = new Walker({ x: 4, z: 26, yaw: 0 });
    w.update(1, { x: 0, z: 1 });
    expect(w.speed).toBeCloseTo(WALK_SPEED_MPS, 5);
    expect(w.speed).toBeLessThan(SPEED_LIMIT_MPS);
  });

  it("follows a path to the end, then calls back", () => {
    const grid = new NavGrid();
    const target = MATS[7] ?? SPAWN;
    const path = grid.findPath(SPAWN, target);
    const w = new Walker(SPAWN);
    let arrived = false;
    w.follow(path ?? [], () => (arrived = true));
    for (let t = 0; t < 120 && !arrived; t += 1 / 30) {
      w.update(1 / 30, null);
      expect(w.speed).toBeLessThanOrEqual(WALK_SPEED_MPS + 1e-6);
      expect(isWalkable(w.x, w.z)).toBe(true);
    }
    expect(arrived).toBe(true);
    expect(w.x).toBeCloseTo(target.x, 5);
    expect(w.z).toBeCloseTo(target.z, 5);
  });

  it("a key press cancels tap-to-walk without arriving", () => {
    const w = new Walker(SPAWN);
    let arrived = false;
    w.follow([{ x: 0, z: 40 }], () => (arrived = true));
    w.update(0.5, null);
    w.update(0.1, { x: 1, z: 0 });
    expect(w.walkingPath).toBe(false);
    w.update(30, null);
    expect(arrived).toBe(false);
  });

  it("turns in place to face a mat's direction", () => {
    const mat = MATS[3] ?? SPAWN;
    const w = new Walker({ ...mat, yaw: 0 });
    w.face(mat.yaw);
    for (let i = 0; i < 60; i++) w.update(1 / 30, null);
    expect(w.yaw).toBeCloseTo(mat.yaw, 5);
  });
});
