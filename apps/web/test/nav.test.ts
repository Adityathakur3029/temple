import { describe, expect, it } from "vitest";
import {
  AARTI_PLATE,
  BELLS,
  BELL_IDS,
  BELL_REACH_M,
  CHECKPOINTS,
  DIYA_SPOT_POSITIONS,
  GANESHA,
  JAL_SPOT,
  MATS,
  SPAWN,
  distance,
  inSacredZone,
  isWalkable,
  segmentBlocked,
  type Point,
} from "@sannidhi/protocol";
import { NavGrid, isClear } from "../src/scene/nav";

const half = new NavGrid("half-somasutra");
const full = new NavGrid("full");

/** Every point along the walk, every 5 cm. */
function along(start: Point, path: readonly Point[]): Point[] {
  const out: Point[] = [];
  let a = start;
  for (const b of path) {
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.05));
    for (let i = 0; i <= n; i++)
      out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
    a = b;
  }
  return out;
}

function length(start: Point, path: readonly Point[]): number {
  let total = 0;
  let a = start;
  for (const b of path) {
    total += distance(a, b);
    a = b;
  }
  return total;
}

function expectSafe(
  start: Point,
  path: readonly Point[] | null,
  mode: "half-somasutra" | "full" = "half-somasutra",
): void {
  expect(path).not.toBeNull();
  // Sent at 10 Hz, every step of the walk passes the server's movement rule: no false corrections.
  const steps = along(start, path ?? []).filter((_p, i) => i % 3 === 0);
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1] ?? start;
    const b = steps[i] ?? start;
    expect(segmentBlocked(a, b, mode), `step (${a.x.toFixed(2)}, ${a.z.toFixed(2)})`).toBeNull();
  }
  for (const p of along(start, path ?? [])) {
    expect(isWalkable(p.x, p.z, mode), `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true);
    // The body keeps (nearly) its 0.25 m radius clear on a grid path.
    expect(
      isClear(p.x, p.z, 0.18, mode),
      `clearance at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`,
    ).toBe(true);
  }
}

describe("tap-to-walk reaches every ritual spot from the gate (spec 02 § Acceptance)", () => {
  const spots: [string, Point, number][] = [
    ...MATS.map((m, i): [string, Point, number] => [`mat ${i}`, m, 0.01]),
    ...DIYA_SPOT_POSITIONS.map((s, i): [string, Point, number] => [`diya spot ${i}`, s, 0.01]),
    ["jal spot", JAL_SPOT, 0.01],
    ...BELL_IDS.map((id): [string, Point, number] => [`bell ${id}`, BELLS[id], BELL_REACH_M - 0.3]),
    ...Object.entries(CHECKPOINTS).map(([id, c]): [string, Point, number] => [
      `checkpoint ${id}`,
      c,
      0.01,
    ]),
    ["aarti plate", AARTI_PLATE, 1.5],
    ["Ganesha shrine", GANESHA, 3],
  ];

  it.each(spots)("%s", (_name, target, within) => {
    const path = half.findPath(SPAWN, target);
    expectSafe(SPAWN, path);
    expect(distance(path?.at(-1) ?? SPAWN, target)).toBeLessThanOrEqual(within);
  });
});

describe("paths keep clear of sacred zones", () => {
  it("goes round the Nandi axis from one block of mats to the other", () => {
    const from = MATS[0] ?? SPAWN;
    const to = MATS[20] ?? SPAWN;
    const path = half.findPath(from, to);
    expectSafe(from, path);
    expect(length(from, path ?? [])).toBeGreaterThan(distance(from, to) + 10);
  });

  it.each([
    ["the linga", { x: 0, z: 0 }],
    ["the sanctum door", { x: 0, z: 2.8 }],
    ["the aisle", { x: 0, z: 12 }],
    ["Nandi", { x: 0, z: 22 }],
    ["the kund water", { x: 16, z: 32 }],
    ["the somasutra", { x: 8, z: 0 }],
  ])("a tap on %s walks to the nearest place a visitor can stand", (_name, target) => {
    const path = half.findPath(SPAWN, target);
    expectSafe(SPAWN, path);
    const end = path?.at(-1) ?? SPAWN;
    expect(inSacredZone(end.x, end.z)).toBe(false);
    expect(distance(end, target)).toBeLessThan(4.5);
  });

  it("never crosses the somasutra in half mode, so N to the far side goes the long way", () => {
    const from = CHECKPOINTS.N;
    const to = { x: 10.5, z: 4 };
    const path = half.findPath(from, to);
    expectSafe(from, path);
    expect(length(from, path ?? [])).toBeGreaterThan(50);
  });

  it("crosses on the bridge in full mode", () => {
    const from = CHECKPOINTS.N;
    const to = { x: 10.5, z: 4 };
    const path = full.findPath(from, to);
    expectSafe(from, path, "full");
    expect(length(from, path ?? [])).toBeLessThan(10);
  });

  it("returns null when nothing reachable is near the tap", () => {
    expect(half.findPath(SPAWN, { x: 200, z: 200 })).toBeNull();
  });
});
