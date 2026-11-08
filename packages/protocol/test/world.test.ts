import { describe, expect, it } from "vitest";
import {
  AARTI_PLATE,
  ANTARALA,
  BELLS,
  BELL_IDS,
  BELL_REACH_M,
  BODY_RADIUS,
  CHECKPOINTS,
  COMPOUND,
  COURTYARD,
  DEEPA_STAND,
  DIYA_SPOTS,
  DIYA_SPOT_POSITIONS,
  GANESHA,
  GARBHAGRIHA,
  GATE,
  JAL_SPOT,
  KUND,
  KUND_WATER,
  LINGA,
  MANDAPA,
  MAT_COLUMNS_X,
  MAT_COUNT,
  MAT_ROWS_Z,
  MATS,
  NANDI,
  NANDI_AXIS,
  PRADAKSHINA,
  SOMASUTRA,
  SOMASUTRA_BRIDGE,
  SPAWN,
  TODAY_BOARD,
  WALKABLE,
  blockedAt,
  distance,
  inMandapa,
  inSacredZone,
  inShape,
  isWalkable,
  sacredZones,
  segmentBlocked,
  yawTowards,
  type Point,
  type Rect,
  type Shape,
} from "../src/index";
import { readSpec, section, tableRows } from "./spec";

const spec = readSpec("02-temple-world.md");
const MODES = ["half-somasutra", "full"] as const;

/** Spec numbers use the Unicode minus sign. */
const num = (s: string): number => Number(s.trim().replace(/−/g, "-").replace(/^±/, ""));
const NUM = String.raw`[−±-]?\d+(?:\.\d+)?`;

function coords(text: string): Point[] {
  return [...text.matchAll(new RegExp(String.raw`\((${NUM}), (${NUM})\)`, "g"))].map((m) => ({
    x: num(m[1] ?? ""),
    z: num(m[2] ?? ""),
  }));
}

function ranges(text: string): Omit<Rect, "kind"> {
  const m = new RegExp(String.raw`x (${NUM}) … (${NUM}), z (${NUM}) … (${NUM})`).exec(text);
  if (!m) throw new Error(`no "x … , z …" range in: ${text}`);
  return { x0: num(m[1] ?? ""), x1: num(m[2] ?? ""), z0: num(m[3] ?? ""), z1: num(m[4] ?? "") };
}

const layout = new Map(
  tableRows(section(spec, "Layout")).map(([el = "", pos = "", notes = ""]) => [
    el,
    `${pos} | ${notes}`,
  ]),
);
const greybox = new Map(
  tableRows(section(spec, "Greybox details")).map(([item = "", value = ""]) => [item, value]),
);
function row(table: Map<string, string>, prefix: string): string {
  const key = [...table.keys()].find((k) => k.startsWith(prefix));
  if (key === undefined) throw new Error(`spec 02 table has no row starting "${prefix}"`);
  return table.get(key) ?? "";
}

/** Points on a grid covering a shape's bounds, keeping those inside it. */
function samplesIn(s: Shape, step = 0.1): Point[] {
  const b =
    s.kind === "rect"
      ? s
      : s.kind === "circle"
        ? { x0: s.x - s.r, x1: s.x + s.r, z0: s.z - s.r, z1: s.z + s.r }
        : {
            x0: Math.min(s.ax, s.bx) - s.r,
            x1: Math.max(s.ax, s.bx) + s.r,
            z0: Math.min(s.az, s.bz) - s.r,
            z1: Math.max(s.az, s.bz) + s.r,
          };
  const out: Point[] = [];
  for (let x = b.x0; x <= b.x1 + 1e-9; x += step) {
    for (let z = b.z0; z <= b.z1 + 1e-9; z += step) if (inShape(s, x, z)) out.push({ x, z });
  }
  return out;
}

/** The disc a client avatar occupies (0.25 m body radius, spec 02 § Greybox details) is clear. */
function clearFor(p: Point, r = BODY_RADIUS): boolean {
  if (!isWalkable(p.x, p.z)) return false;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (!isWalkable(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r)) return false;
  }
  return true;
}

const angleBetween = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("world.ts matches spec 02", () => {
  it("places each landmark where the layout table says", () => {
    expect(coords(row(layout, "Garbhagriha"))[0]).toEqual(LINGA);
    expect(coords(row(layout, "Nandi on a platform"))[0]).toEqual({ x: NANDI.x, z: NANDI.z });
    expect(coords(row(layout, "Deepa stand"))[0]).toEqual(DEEPA_STAND);
    expect(coords(row(layout, "Aarti plate stand"))[0]).toEqual(AARTI_PLATE);
    expect(coords(row(layout, "Ganesha shrine"))[0]).toEqual({ x: GANESHA.x, z: GANESHA.z });
    expect(coords(row(layout, "Gate (torana)"))[0]).toEqual(GATE);
    expect(coords(row(layout, "Temple-wide"))[0]).toEqual({ x: TODAY_BOARD.x, z: TODAY_BOARD.z });
    expect(coords(row(layout, "Kund"))[0]).toEqual({
      x: (KUND.x0 + KUND.x1) / 2,
      z: (KUND.z0 + KUND.z1) / 2,
    });
    const [spout, end] = coords(row(layout, "Jaladhari"));
    expect(spout).toEqual({ x: SOMASUTRA.x0, z: SOMASUTRA.z });
    expect(end).toEqual({ x: SOMASUTRA.x1, z: SOMASUTRA.z });
  });

  it("uses the layout table's areas", () => {
    expect(ranges(row(layout, "Mandapa (open hall)"))).toEqual(rectBounds(MANDAPA));
    expect(ranges(row(layout, "Courtyard"))).toEqual(rectBounds(COURTYARD));
    expect(ranges(row(layout, "Nandi on a platform"))).toEqual(rectBounds(NANDI_AXIS));
    const antarala = new RegExp(String.raw`z (${NUM}) … (${NUM})`).exec(row(layout, "Antarala"));
    expect([num(antarala?.[1] ?? ""), num(antarala?.[2] ?? "")]).toEqual([
      ANTARALA.z0,
      ANTARALA.z1,
    ]);
  });

  it("hangs both mandapa bells and every path bell where the spec says", () => {
    const [mandapa] = coords(row(layout, "Mandapa bells"));
    expect(BELLS["mandapa-n"]).toEqual({ x: Math.abs(mandapa?.x ?? 0), z: mandapa?.z });
    expect(BELLS["mandapa-s"]).toEqual({ x: -Math.abs(mandapa?.x ?? 0), z: mandapa?.z });
    const text = row(greybox, "Path bells");
    for (let n = 1; n <= 8; n++) {
      const m = new RegExp(String.raw`\`path-${n}\` \((${NUM}), (${NUM})\)`).exec(text);
      expect(m, `path-${n}`).not.toBeNull();
      expect(BELLS[`path-${n}` as keyof typeof BELLS]).toEqual({
        x: num(m?.[1] ?? ""),
        z: num(m?.[2] ?? ""),
      });
    }
    expect(coords(text).at(-1)).toEqual(BELLS.gate);
  });

  it("puts the checkpoints where § Pradakshina path says", () => {
    const text = section(spec, "Pradakshina path");
    for (const id of ["E", "S", "W", "N"] as const) {
      const m = new RegExp(String.raw`\`${id}\` \((${NUM}), (${NUM})\)`).exec(text);
      expect(m, id).not.toBeNull();
      expect(CHECKPOINTS[id]).toEqual({ x: num(m?.[1] ?? ""), z: num(m?.[2] ?? "") });
    }
  });

  it("lays out the mats on the greybox grid", () => {
    const text = row(greybox, "Mats");
    const cols = /columns at x ([^a-z]+) and/.exec(text)?.[1]?.split(",").map(num);
    const rows = /rows at z ((?:\d+(?:\.\d+)?(?:, )?)+)/.exec(text)?.[1]?.split(",").map(num);
    expect(cols).toEqual(MAT_COLUMNS_X);
    expect(rows).toEqual(MAT_ROWS_Z);
  });

  it("uses the greybox compound, kund water and spawn", () => {
    expect(ranges(row(greybox, "Walkable area"))).toEqual(rectBounds(COMPOUND));
    expect(ranges(row(greybox, "Kund steps"))).toEqual(rectBounds(KUND_WATER));
    expect(coords(row(greybox, "Spawn"))[0]).toEqual({ x: SPAWN.x, z: SPAWN.z });
    expect(coords(row(greybox, "Jal spot"))[0]).toEqual({ x: JAL_SPOT.x, z: JAL_SPOT.z });
  });
});

function rectBounds(r: Rect): Omit<Rect, "kind"> {
  return { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 };
}

describe("sacred and blocked zones", () => {
  it.each(MODES)("no point inside the garbhagriha is walkable (%s)", (mode) => {
    for (const p of samplesIn(GARBHAGRIHA))
      expect(isWalkable(p.x, p.z, mode), JSON.stringify(p)).toBe(false);
    expect(blockedAt(0, 0, mode)).toBe("garbhagriha");
  });

  it.each(MODES)("no point on the Nandi axis is walkable (%s)", (mode) => {
    for (const p of samplesIn(NANDI_AXIS))
      expect(isWalkable(p.x, p.z, mode), JSON.stringify(p)).toBe(false);
    expect(blockedAt(0, 12, mode)).toBe("nandi-axis");
    // The whole line from the door to Nandi is covered.
    for (let z = 0; z <= 22; z += 0.05) expect(inSacredZone(0, z, mode)).toBe(true);
  });

  it.each(MODES)("the kund water and below the second step are blocked (%s)", (mode) => {
    for (const p of samplesIn(KUND_WATER)) expect(isWalkable(p.x, p.z, mode)).toBe(false);
    // The first two steps (1.2 m in from the rim) are walkable.
    expect(isWalkable(KUND.x0 + 0.3, 32, mode)).toBe(true);
    expect(isWalkable(KUND.x0 + 1.1, 32, mode)).toBe(true);
    expect(isWalkable(KUND.x0 + 1.3, 32, mode)).toBe(false);
  });

  it("in half mode, the somasutra can't be crossed anywhere north of the shrine", () => {
    for (let x = SOMASUTRA.x0; x <= 30; x += 0.05) {
      for (let z = -SOMASUTRA.halfWidth; z <= SOMASUTRA.halfWidth; z += 0.05) {
        expect(isWalkable(x, z, "half-somasutra"), `(${x}, ${z})`).toBe(false);
      }
    }
    // It reaches the forest edge, so nobody can walk round its end.
    expect(SOMASUTRA.x1).toBe(COMPOUND.x1);
    for (const s of WALKABLE) {
      const nearChannel = samplesIn(s, 0.25).some((p) => Math.abs(p.z) <= SOMASUTRA.halfWidth);
      if (nearChannel) expect(maxX(s)).toBeLessThanOrEqual(SOMASUTRA.x1);
    }
  });

  it("in full mode, the channel is crossed only on the bridge", () => {
    for (let x = SOMASUTRA.x0; x <= 30; x += 0.05) {
      const onBridge = x >= SOMASUTRA_BRIDGE.x0 && x <= SOMASUTRA_BRIDGE.x1;
      const walkable = isWalkable(x, 0, "full");
      if (!onBridge) expect(walkable, `x = ${x}`).toBe(false);
    }
    expect(isWalkable(PRADAKSHINA.x, 0, "full")).toBe(true);
    expect(isWalkable(PRADAKSHINA.x, 0, "half-somasutra")).toBe(false);
  });

  it("reports sacred zones by name and everything else as blocked", () => {
    expect(blockedAt(16, 32)).toBe("kund-water");
    expect(blockedAt(8, 0)).toBe("somasutra");
    expect(blockedAt(0, 22)).toBe("nandi-axis");
    expect(blockedAt(0, 22.5)).toBe("nandi");
    expect(blockedAt(6.5, 10)).toBe("pillar");
    expect(blockedAt(7.2, 12)).toBe("plinth-edge");
    expect(blockedAt(DEEPA_STAND.x, DEEPA_STAND.z)).toBe("deepa-stand");
    expect(blockedAt(0, 80)).toBe("outside");
    expect(blockedAt(4, 12)).toBeNull();
  });

  it("never accepts non-finite positions", () => {
    for (const [x, z] of [
      [NaN, 0],
      [0, NaN],
      [Infinity, 10],
      [4, -Infinity],
    ] as const) {
      expect(isWalkable(x, z)).toBe(false);
    }
  });

  it("lists the same zones in both modes", () => {
    expect(sacredZones("full").map((z) => z.id)).toEqual(
      sacredZones("half-somasutra").map((z) => z.id),
    );
  });
});

function maxX(s: Shape): number {
  return s.kind === "rect" ? s.x1 : s.kind === "circle" ? s.x + s.r : Math.max(s.ax, s.bx) + s.r;
}

describe("ritual spots", () => {
  it("has MAT_COUNT mats in two blocks of 20 either side of the aisle", () => {
    expect(MATS).toHaveLength(MAT_COUNT);
    expect(MATS.slice(0, 20).every((m) => m.x > NANDI_AXIS.x1)).toBe(true);
    expect(MATS.slice(20).every((m) => m.x < NANDI_AXIS.x0)).toBe(true);
    for (const m of MATS) {
      expect(inMandapa(m.x, m.z)).toBe(true);
      expect(clearFor(m), JSON.stringify(m)).toBe(true);
    }
  });

  it("seats every visitor facing the linga (within ±10°)", () => {
    for (const m of MATS)
      expect(angleBetween(m.yaw, yawTowards(m, LINGA))).toBeLessThan((10 * Math.PI) / 180);
  });

  it("leaves room between mats", () => {
    for (let i = 0; i < MATS.length; i++) {
      for (let j = i + 1; j < MATS.length; j++) {
        expect(distance(MATS[i] ?? LINGA, MATS[j] ?? LINGA)).toBeGreaterThanOrEqual(0.95);
      }
    }
  });

  it("has DIYA_SPOTS standing spots around the deepa stand, each facing it", () => {
    expect(DIYA_SPOT_POSITIONS).toHaveLength(DIYA_SPOTS);
    for (const s of DIYA_SPOT_POSITIONS) {
      expect(clearFor(s)).toBe(true);
      expect(angleBetween(s.yaw, yawTowards(s, DEEPA_STAND))).toBeLessThan(1e-9);
    }
  });

  it("puts the jal spot at the threshold, beside the door and off the axis", () => {
    expect(clearFor(JAL_SPOT)).toBe(true);
    expect(inShape(ANTARALA, JAL_SPOT.x, JAL_SPOT.z)).toBe(true);
    expect(JAL_SPOT.x).toBeGreaterThan(NANDI_AXIS.x1 + 0.25);
  });

  it("lets a visitor stand within reach of every bell", () => {
    for (const id of BELL_IDS) {
      const bell = BELLS[id];
      let reachable = false;
      for (let dx = -BELL_REACH_M; dx <= BELL_REACH_M && !reachable; dx += 0.1) {
        for (let dz = -BELL_REACH_M; dz <= BELL_REACH_M && !reachable; dz += 0.1) {
          const p = { x: bell.x + dx, z: bell.z + dz };
          if (distance(p, bell) <= BELL_REACH_M - 0.5 && clearFor(p)) reachable = true;
        }
      }
      expect(reachable, id).toBe(true);
    }
  });

  it("can stand at the spawn, the checkpoints and in front of the shrines", () => {
    expect(clearFor(SPAWN)).toBe(true);
    for (const c of Object.values(CHECKPOINTS)) expect(clearFor(c), JSON.stringify(c)).toBe(true);
    expect(clearFor({ x: AARTI_PLATE.x, z: AARTI_PLATE.z + 0.8 })).toBe(true);
    expect(clearFor({ x: GANESHA.x + 2, z: GANESHA.z })).toBe(true);
  });

  it("puts N on the path just before the channel, coming from W", () => {
    expect(CHECKPOINTS.N.x).toBe(PRADAKSHINA.x);
    expect(CHECKPOINTS.N.z).toBeLessThan(SOMASUTRA.z - SOMASUTRA.halfWidth);
    expect(CHECKPOINTS.N.z).toBeGreaterThan(CHECKPOINTS.W.z);
  });

  it("starts visitors inside the gate, facing the temple", () => {
    expect(SPAWN.z).toBeLessThan(GATE.z);
    expect(Math.cos(SPAWN.yaw)).toBeCloseTo(-1);
  });
});

describe("yaw convention (spec 02 § Purpose)", () => {
  it("is 0 facing east and π/2 facing north", () => {
    expect(yawTowards(LINGA, { x: 0, z: 1 })).toBe(0);
    expect(yawTowards(LINGA, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(yawTowards(LINGA, { x: 0, z: -1 }))).toBeCloseTo(Math.PI);
  });
});

describe("segmentBlocked: a step can't hop over a zone (spec 05 § Movement rule)", () => {
  it.each([
    ["the somasutra", { x: 8, z: -0.5 }, { x: 8, z: 0.5 }, "somasutra"],
    ["the Nandi axis", { x: -1.3, z: 12 }, { x: 1.3, z: 12 }, "nandi-axis"],
    ["the garbhagriha", { x: -2.9, z: 1 }, { x: 2.9, z: 1 }, "garbhagriha"],
    ["the kund water", { x: 12.5, z: 32 }, { x: 19.5, z: 32 }, "kund-water"],
  ])("refuses a hop across %s although both ends are walkable", (_name, a, b, zone) => {
    expect(isWalkable(a.x, a.z)).toBe(true);
    expect(isWalkable(b.x, b.z)).toBe(true);
    expect(segmentBlocked(a, b)).toBe(zone);
  });

  it("refuses a step through a pillar or out past the forest edge", () => {
    expect(segmentBlocked({ x: 6.5, z: 9.4 }, { x: 6.5, z: 10.6 })).toBe("pillar");
    expect(segmentBlocked({ x: 14, z: 5 }, { x: 15.5, z: 5 })).toBe("outside");
  });

  it("allows ordinary steps, including over the bridge in full mode", () => {
    expect(segmentBlocked({ x: 4, z: 26 }, { x: 4.13, z: 26 })).toBeNull();
    expect(segmentBlocked({ x: 4, z: 26 }, { x: 4, z: 26 })).toBeNull();
    expect(segmentBlocked({ x: 10.5, z: -0.7 }, { x: 10.5, z: 0.7 }, "full")).toBeNull();
    expect(segmentBlocked({ x: 10.5, z: -0.7 }, { x: 10.5, z: 0.7 }, "half-somasutra")).toBe(
      "somasutra",
    );
  });

  it("never accepts non-finite steps", () => {
    expect(segmentBlocked({ x: 4, z: 26 }, { x: NaN, z: 26 })).toBe("outside");
    expect(segmentBlocked({ x: Infinity, z: 26 }, { x: 4, z: 26 })).toBe("outside");
  });
});

describe("wire order of mats and diya spots (spec 04 § Shared types)", () => {
  it("numbers mats from the north block's front row, inner column first", () => {
    expect(
      [MATS[0], MATS[3], MATS[4], MATS[19], MATS[20], MATS[39]].map((m) => [m?.x, m?.z]),
    ).toEqual([
      [2.4, 8.2],
      [5.4, 8.2],
      [2.4, 9.6],
      [5.4, 13.8],
      [-2.4, 8.2],
      [-5.4, 13.8],
    ]);
  });

  it("numbers diya spots north, east, south, west", () => {
    const [n, e, s, w] = DIYA_SPOT_POSITIONS;
    expect(n?.x).toBeGreaterThan(DEEPA_STAND.x);
    expect(e?.z).toBeGreaterThan(DEEPA_STAND.z);
    expect(s?.x).toBeLessThan(DEEPA_STAND.x);
    expect(w?.z).toBeLessThan(DEEPA_STAND.z);
  });
});
