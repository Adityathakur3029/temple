/**
 * The M1 greybox (spec 02 § Layout and § Greybox details): blockout shapes for every element of the
 * temple, built in code from world.ts. Final art (M5) replaces these through the asset manifest.
 *
 * Placeholders for the sacred forms are deliberately plain (spec 08 § Depiction): the linga is a
 * simple dark stone form on its pitha; Nandi is plain stone blocks that only suggest the seated
 * form and its facing; the Ganesha murti is an unadorned stone mass. None has a face. All are
 * replaced by the human-made, advisor-reviewed assets.
 *
 * Each asset slot's shapes are a named section of the merged mesh, so a loaded model can take a
 * shape's place (hide) without another draw call for the rest (scene/models.ts, spec 11 § Slots).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from "three";
import {
  ANTARALA,
  AARTI_PLATE,
  BELLS,
  BELL_IDS,
  circle,
  COMPOUND,
  COURTYARD,
  DEEPA_STAND,
  GANESHA,
  GANESHA_FRONT,
  GANESHA_SHRINE,
  GATE,
  GATE_APPROACH,
  GATE_INSIDE,
  GATE_PATH,
  GATE_PATH_HALF_WIDTH,
  GATE_PILLARS,
  KUND,
  KUND_WATER,
  MANDAPA,
  MANDAPA_PILLARS,
  MATS,
  NANDI_AXIS,
  NANDI_PLATFORM,
  PRADAKSHINA,
  rect,
  SANCTUM_DOOR,
  SOMASUTRA,
  SOMASUTRA_BRIDGE,
  TODAY_BOARD,
  WALKABLE,
  type BellId,
  type PradakshinaMode,
  type Shape as WorldShape,
} from "@sannidhi/protocol";
import type { AssetTier } from "../assets/manifest";
import { SLOTS, type SlotId } from "../assets/slots";
import { MeshBuilder, placed, withoutSection } from "./builder";
import { HEIGHTS, KUND_FLOOR_Y, KUND_STEP, KUND_WATER_Y, PAVING, PLINTH } from "./ground";

/** Weathered grey-brown stone, deodar green, brass and a few warm accents (spec 02 § Setting). */
export const COLOURS = {
  forest: "#47502f",
  paving: "#8b8375",
  path: "#a39a8b",
  court: "#968d7e",
  aisle: "#a59c8c",
  plinth: "#7d7366",
  moulding: "#6b6256",
  stone: "#8b8070",
  stoneDark: "#71675a",
  shikhara: "#867b6b",
  interior: "#2f2a25",
  sanctumFloor: "#3e3832",
  linga: "#2e2b28",
  pitha: "#34302c",
  wood: "#6a4a32",
  woodDark: "#4f3725",
  brass: "#b08d3c",
  mat: "#7b3a2f",
  kund: "#7a7469",
  channel: "#6e695f",
  groove: "#34342f",
  sacredStone: "#5d5852",
  trunk: "#4a3626",
  rock: "#6b6e72",
  snow: "#e6ecf0",
  board: "#b9a27c",
  kerb: "#6f695e",
  water: "#3d5c5e",
  lamp: "#ffc46a",
} as const;

const TAU = Math.PI * 2;

/** Seeded random numbers, so every visitor sees the same forest. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Centre line x of the gate path at a given z. */
export function gatePathX(z: number): number {
  for (let i = 1; i < GATE_PATH.length; i++) {
    const a = GATE_PATH[i - 1];
    const b = GATE_PATH[i];
    if (!a || !b) continue;
    if (z <= a.z && z >= b.z) return a.x + ((b.x - a.x) * (a.z - z)) / (a.z - b.z);
  }
  return 0;
}

function nearShape(s: WorldShape, x: number, z: number, m: number): boolean {
  switch (s.kind) {
    case "rect":
      return x >= s.x0 - m && x <= s.x1 + m && z >= s.z0 - m && z <= s.z1 + m;
    case "circle":
      return Math.hypot(x - s.x, z - s.z) <= s.r + m;
    case "capsule": {
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / (sx * sx + sz * sz)));
      return Math.hypot(x - (s.ax + t * sx), z - (s.az + t * sz)) <= s.r + m;
    }
  }
}

/** Box ring between two insets of a rect (kund steps and surrounds). */
function ring(
  b: MeshBuilder,
  r: { x0: number; x1: number; z0: number; z1: number },
  in0: number,
  in1: number,
  y0: number,
  y1: number,
  colour: string,
): void {
  const ox0 = r.x0 + in0;
  const ox1 = r.x1 - in0;
  const oz0 = r.z0 + in0;
  const oz1 = r.z1 - in0;
  const ix0 = r.x0 + in1;
  const ix1 = r.x1 - in1;
  const iz0 = r.z0 + in1;
  const iz1 = r.z1 - in1;
  b.box(ox0, ox1, y0, y1, oz0, iz0, colour);
  b.box(ox0, ox1, y0, y1, iz1, oz1, colour);
  b.box(ox0, ix0, y0, y1, iz0, iz1, colour);
  b.box(ix1, ox1, y0, y1, iz0, iz1, colour);
}

/** A curved Nagara tower as a 4-sided lathe; `profile` is [half side, y] from the base up. */
function tower(profile: readonly (readonly [number, number])[]): LatheGeometry {
  return new LatheGeometry(
    profile.map(([s, y]) => new Vector2(s * Math.SQRT2, y)),
    4,
  );
}

function kalasha(): LatheGeometry {
  const pts: [number, number][] = [
    [0.2, 0],
    [0.36, 0.1],
    [0.42, 0.26],
    [0.32, 0.42],
    [0.13, 0.52],
    [0.17, 0.6],
    [0.06, 0.86],
    [0.001, 1],
  ];
  return new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, y)),
    16,
  );
}

function amalaka(): LatheGeometry {
  const pts: [number, number][] = [
    [0.001, 0],
    [0.9, 0.02],
    [1.18, 0.14],
    [1.25, 0.28],
    [1.18, 0.42],
    [0.9, 0.54],
    [0.001, 0.56],
  ];
  return new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, y)),
    24,
  );
}

function bellGeometry(): LatheGeometry {
  const pts: [number, number][] = [
    [0.001, 0],
    [0.04, -0.01],
    [0.075, -0.05],
    [0.095, -0.13],
    [0.11, -0.22],
    [0.15, -0.3],
    [0.165, -0.32],
    [0.14, -0.315],
  ];
  return new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, y)),
    14,
  );
}

/** A small brass standing lamp (the post-lamp slot's shape), its bottom centre at the origin. */
function postLampGeometry(): LatheGeometry {
  const h = SLOTS["post-lamp"].fit.size;
  // [radius, height] for a 0.28 m lamp: foot, stem with a knop, wide tray, and a finial for the wick.
  const pts: [number, number][] = [
    [0.001, 0],
    [0.085, 0],
    [0.085, 0.012],
    [0.07, 0.02],
    [0.03, 0.05],
    [0.018, 0.08],
    [0.032, 0.11],
    [0.018, 0.14],
    [0.02, 0.17],
    [0.09, 0.2],
    [0.095, 0.21],
    [0.03, 0.205],
    [0.026, 0.23],
    [0.02, 0.26],
    [0.008, 0.28],
    [0.001, 0.28],
  ];
  return new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, (y * h) / 0.28)),
    12,
  );
}

/** The top of the lamp shelf on each path post. */
export const POST_SHELF_TOP = 1.46;
/** How far each post lamp stands from its post's centre, towards the path. */
export const POST_LAMP_OUT = 0.18;

export interface PathPost {
  /** The bell it holds. */
  id: BellId;
  x: number;
  z: number;
  /** The side of the path the post stands on (+1 is +x); the path is towards −side. */
  side: number;
}

/**
 * The posts that hold the path bells: just off the path, with room for the lamp shelf, so the
 * lamp doesn't reach over where visitors walk.
 */
export function pathPosts(): PathPost[] {
  return BELL_IDS.filter((id) => id.startsWith("path")).map((id) => {
    const p = BELLS[id];
    const side = Math.sign(p.x - gatePathX(p.z)) || 1;
    let x = p.x + side * 0.6;
    while (WALKABLE.some((s) => nearShape(s, x, p.z, 0.3))) x += side * 0.1;
    return { id, x, z: p.z, side };
  });
}

/** Where each bell hangs (its top), and how big it is. */
export function bellHangs(): Record<BellId, { x: number; y: number; z: number; scale: number }> {
  const out = {} as Record<BellId, { x: number; y: number; z: number; scale: number }>;
  for (const id of BELL_IDS) {
    const p = BELLS[id];
    if (id === "gate") out[id] = { x: p.x, y: 2.95, z: p.z, scale: 1.4 };
    else if (id.startsWith("mandapa")) out[id] = { x: p.x, y: 3.55, z: p.z, scale: 1.25 };
    else out[id] = { x: p.x, y: 2.4, z: p.z, scale: 1 };
  }
  return out;
}

export interface Greybox {
  group: Group;
  /** The merged static greybox: the floors and everything solid. */
  ground: Mesh;
  /**
   * Raycast target for tap-to-walk: the whole greybox as first built, never drawn. Models that
   * replace greybox shapes are not raycast, so a tap stays cheap (spec 10).
   */
  tapMesh: Mesh;
  mats: InstancedMesh;
  /** One instance per bell, in BELL_IDS order; their matrices swing when rung (scene/bells.ts). */
  bells: InstancedMesh;
  bellHang: Record<BellId, { x: number; y: number; z: number; scale: number }>;
  /** The brass lamp on each path post's shelf, in pathPosts() order; their flames are in code. */
  postLamps: InstancedMesh;
  /** The deodars beyond the near trees, nearest the temple first (the tree slot). */
  trees: InstancedMesh;
  /** The deodars closest to where visitors walk, closest first (the near-tree slot). */
  nearTrees: InstancedMesh;
  /** The Himalayan oaks among the deodars, nearest the temple first (the oak slot). */
  oaks: InstancedMesh;
  /**
   * Shows `total` trees (all of them, or Lite's 72): the tier's near deodars and oaks first, then
   * the far deodars nearest the temple (spec 11 § Slots).
   */
  setTrees(total: number, tier: AssetTier): void;
  /** Lamp bodies; their colour is scaled by the time of day. */
  lampMaterial: MeshBasicMaterial;
  glowMaterial: PointsMaterial;
  /** Every mesh that should cast and receive the High-tier shadow. */
  shadowCasters: (Mesh | InstancedMesh)[];
  /** Slots whose greybox shapes are still drawn in the merged mesh. */
  readonly sections: ReadonlySet<SlotId>;
  /** Removes a slot's greybox shapes once its model is in place. */
  hide(slot: SlotId): void;
  dispose(): void;
}

export interface GreyboxOptions {
  mode: PradakshinaMode;
  trees: number;
  /** Which tier's near-tree count to show (default Full). */
  treeTier?: AssetTier;
}

/** Every tree, near and far, deodars and oaks (spec 02 § Setting). */
export const MAX_TREES = 120;
/** Near trees keep within the greybox tree's spread, so none reaches over a path. */
const NEAR_TREE_MAX_SCALE = 1.1;
/** The greybox trees' widest branches (deodar and oak) reach this far from the trunk at scale 1. */
export const TREE_SPREAD = 2.6;
/** The low walls either side of the torana, with their coping. */
export const GATE_WALLS = [
  rect(2.6, 11, GATE.z, GATE.z + 0.4),
  rect(-11, -2.6, GATE.z, GATE.z + 0.4),
] as const;

/**
 * What stands outside the walkable area beside the paths, and how far trees keep from it: their
 * branch tips at least `gap` away, and their trunk at least `trunk` away. The Ganesha shrine (with
 * its 0.15 m roof overhang) stands against open forest, not inside a tree (spec 08 § Depiction);
 * no lamp on a bell post sits in the branches.
 */
export const TREES_KEEP_CLEAR: readonly { shape: WorldShape; gap: number; trunk: number }[] = [
  {
    shape: rect(
      GANESHA_SHRINE.x0 - 0.15,
      GANESHA_SHRINE.x1 + 0.15,
      GANESHA_SHRINE.z0 - 0.15,
      GANESHA_SHRINE.z1 + 0.15,
    ),
    gap: 1,
    trunk: 3,
  },
  ...GATE_WALLS.map((shape) => ({ shape, gap: 0.3, trunk: 0 })),
  ...pathPosts().map((p) => ({ shape: circle(p.x, p.z, 0.1), gap: 0.5, trunk: 0 })),
  { shape: circle(TODAY_BOARD.x, TODAY_BOARD.z, 0.8), gap: 0.3, trunk: 0 },
];

export function buildGreybox(opts: GreyboxOptions): Greybox {
  const C = COLOURS;
  const b = new MeshBuilder();
  const lamps = new MeshBuilder();
  const glow: number[] = [];
  const addLamp = (x: number, y: number, z: number, size = 0.12): void => {
    lamps.box(
      x - size / 2,
      x + size / 2,
      y - size * 0.6,
      y + size * 0.6,
      z - size / 2,
      z + size / 2,
      C.lamp,
    );
    glow.push(x, y, z);
  };

  // --- Ground: forest floor with a hole for the kund ---------------------------------------
  const disc = new Shape();
  disc.absarc(0, 0, 650, 0, TAU, false);
  const hole = new Path();
  hole.moveTo(KUND.x0, -KUND.z0);
  hole.lineTo(KUND.x1, -KUND.z0);
  hole.lineTo(KUND.x1, -KUND.z1);
  hole.lineTo(KUND.x0, -KUND.z1);
  hole.closePath();
  disc.holes.push(hole);
  const groundGeo = new ShapeGeometry(disc, 48);
  groundGeo.rotateX(-Math.PI / 2);
  b.add(groundGeo, null, C.forest);

  // --- Paving --------------------------------------------------------------------------------
  b.box(COMPOUND.x0, COMPOUND.x1, 0, 0.012, COMPOUND.z0, KUND.z0, C.paving);
  b.box(COMPOUND.x0, KUND.x0, 0, 0.012, KUND.z0, COMPOUND.z1, C.paving);
  const P = PRADAKSHINA;
  const hw = P.halfWidth;
  b.box(P.x - hw, P.x + hw, 0, PAVING, P.zWest - hw, COURTYARD.z0, C.path);
  b.box(-P.x - hw, -P.x + hw, 0, PAVING, P.zWest - hw, COURTYARD.z0, C.path);
  b.box(-P.x + hw, P.x - hw, 0, PAVING, P.zWest - hw, P.zWest + hw, C.path);
  b.box(COURTYARD.x0, COURTYARD.x1, 0, PAVING, COURTYARD.z0, COURTYARD.z1, C.court);
  for (let i = 1; i < GATE_PATH.length; i++) {
    const a = GATE_PATH[i - 1];
    const c = GATE_PATH[i];
    if (!a || !c) continue;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const yaw = Math.atan2(c.x - a.x, c.z - a.z);
    b.add(
      new BoxGeometry(GATE_PATH_HALF_WIDTH * 2, PAVING, len),
      placed((a.x + c.x) / 2, PAVING / 2, (a.z + c.z) / 2, yaw),
      C.court,
    );
    if (i < GATE_PATH.length - 1) {
      b.add(
        new CylinderGeometry(GATE_PATH_HALF_WIDTH, GATE_PATH_HALF_WIDTH, PAVING, 20),
        placed(c.x, PAVING / 2, c.z),
        C.court,
      );
    }
  }
  for (const r of [GATE_INSIDE, GANESHA_FRONT]) b.box(r.x0, r.x1, 0, PAVING, r.z0, r.z1, C.court);
  // The approach outside the gate, paved on past where visitors may walk.
  const ap = GATE_APPROACH;
  b.box(ap.x0, ap.x1, 0, PAVING, GATE_INSIDE.z1, GATE.z + 14, C.court);

  // Low kerb along the forest edge (the soft wall, spec 02).
  const kerb = (x0: number, x1: number, z0: number, z1: number): void =>
    void b.box(x0, x1, 0, 0.22, z0, z1, C.kerb);
  kerb(COMPOUND.x0 - 0.3, COMPOUND.x1 + 0.3, COMPOUND.z0 - 0.3, COMPOUND.z0);
  kerb(COMPOUND.x0 - 0.3, COMPOUND.x0, COMPOUND.z0, COMPOUND.z1 + 0.3);
  kerb(COMPOUND.x1, COMPOUND.x1 + 0.3, COMPOUND.z0, 26.7);
  kerb(COMPOUND.x0, -1.95, COMPOUND.z1, COMPOUND.z1 + 0.3);
  kerb(1.95, 10.7, COMPOUND.z1, COMPOUND.z1 + 0.3);
  kerb(10.7, 11, COMPOUND.z1 + 0.3, 37);
  kerb(10.7, 21.3, 37, 37.3);
  kerb(21, 21.3, 26.7, 37);
  kerb(COMPOUND.x1, 21, 26.7, 27);

  // --- Kund ----------------------------------------------------------------------------------
  // Each section("…") names the shapes an asset slot replaces (assets/slots.ts, spec 11).
  b.section("kund");
  ring(b, { x0: 11, x1: 21, z0: 27, z1: 37 }, 0, 1, 0, 0.04, C.kund);
  ring(b, KUND, -0.2, 0, -KUND_STEP.drop, 0, C.kund);
  for (let k = 1; k <= 3; k++) {
    ring(
      b,
      KUND,
      (k - 1) * KUND_STEP.width,
      k * KUND_STEP.width,
      KUND_FLOOR_Y,
      -KUND_STEP.drop * k,
      C.kund,
    );
  }
  b.box(
    KUND.x0 + 1.8,
    KUND.x1 - 1.8,
    KUND_FLOOR_Y - 0.05,
    KUND_FLOOR_Y,
    KUND.z0 + 1.8,
    KUND.z1 - 1.8,
    C.groove,
  );
  b.section(null);

  // --- Garbhagriha, antarala and shikhara -------------------------------------------------------
  const wallTop = HEIGHTS.shrineWall;
  const door = SANCTUM_DOOR.halfWidth;
  b.section("shrine");
  b.box(-2.6, 2.6, 0, PLINTH, -2.6, 2.6, C.plinth);
  b.box(-2.6, 2.6, PLINTH, wallTop, -2.6, -2.2, C.stone);
  b.box(2.2, 2.6, PLINTH, wallTop, -2.2, 2.2, C.stone);
  b.box(-2.6, -2.2, PLINTH, wallTop, -2.2, 2.2, C.stone);
  b.box(door, 2.6, PLINTH, wallTop, 2.2, 2.6, C.stone);
  b.box(-2.6, -door, PLINTH, wallTop, 2.2, 2.6, C.stone);
  b.box(-door, door, HEIGHTS.doorTop, wallTop, 2.2, 2.6, C.stone);
  // Bands above head height, so nothing juts into the walkway beside the shrine.
  b.box(-2.7, 2.7, 3.3, 3.48, -2.7, 2.7, C.stoneDark);
  b.box(-2.78, 2.78, wallTop - 0.1, wallTop + 0.2, -2.78, 2.78, C.stoneDark);
  // Inside: darker lining, floor and ceiling (no light reaches in but the sanctum lamps).
  b.box(-2.2, 2.2, PLINTH, PLINTH + 0.015, -2.2, 2.2, C.sanctumFloor);
  b.box(-2.2, 2.2, PLINTH, 4.3, -2.2, -2.19, C.interior);
  b.box(2.19, 2.2, PLINTH, 4.3, -2.2, 2.2, C.interior);
  b.box(-2.2, -2.19, PLINTH, 4.3, -2.2, 2.2, C.interior);
  b.box(door, 2.2, PLINTH, 4.3, 2.19, 2.2, C.interior);
  b.box(-2.2, -door, PLINTH, 4.3, 2.19, 2.2, C.interior);
  b.box(-door, door, HEIGHTS.doorTop, 4.3, 2.19, 2.2, C.interior);
  b.box(-2.2, 2.2, 4.29, 4.3, -2.2, 2.2, C.interior, { bottom: false });
  // Door frame and threshold.
  b.box(door, door + 0.17, PLINTH, HEIGHTS.doorTop + 0.15, 2.6, 2.7, C.woodDark);
  b.box(-door - 0.17, -door, PLINTH, HEIGHTS.doorTop + 0.15, 2.6, 2.7, C.woodDark);
  b.box(-door - 0.17, door + 0.17, HEIGHTS.doorTop, HEIGHTS.doorTop + 0.15, 2.6, 2.7, C.woodDark);
  b.box(-door, door, PLINTH, PLINTH + 0.09, 2.2, 2.72, C.stoneDark);
  // Antarala: plinth, low side walls, pilasters and roof.
  b.box(ANTARALA.x0, ANTARALA.x1, 0, PLINTH, ANTARALA.z0, ANTARALA.z1, C.plinth);
  b.box(2.6, 2.85, PLINTH, 1.1, 2.6, 5, C.stone);
  b.box(-2.85, -2.6, PLINTH, 1.1, 2.6, 5, C.stone);
  b.box(2.6, 2.9, PLINTH, HEIGHTS.antaralaRoof.y0, 4.7, 5, C.stone);
  b.box(-2.9, -2.6, PLINTH, HEIGHTS.antaralaRoof.y0, 4.7, 5, C.stone);
  b.box(-2.9, 2.9, HEIGHTS.antaralaRoof.y0, HEIGHTS.antaralaRoof.y1, 2.6, 5.3, C.stoneDark);
  // Shikhara, amalaka and kalasha (about 16 m, the landmark seen from the gate).
  b.add(
    tower([
      [2.62, wallTop + 0.2],
      [2.58, 5.6],
      [2.5, 7],
      [2.34, 8.5],
      [2.12, 10],
      [1.84, 11.4],
      [1.5, 12.6],
      [1.15, 13.6],
      [0.82, 14.25],
    ]),
    placed(0, 0, 0, Math.PI / 4),
    C.shikhara,
    true,
  );
  b.add(new CylinderGeometry(0.7, 0.8, 0.22, 16), placed(0, 14.36, 0), C.stoneDark, true);
  b.add(amalaka(), placed(0, 14.47, 0), C.stone, true);
  b.add(kalasha(), placed(0, 15.03, 0, 0, 1.05), C.brass);
  // The somasutra spout on the north wall belongs to the shrine; the channel stays.
  b.box(2.6, 3.15, PLINTH + 0.05, PLINTH + 0.17, -0.1, 0.1, C.stoneDark);
  b.section(null);

  // --- Linga on its yoni pitha, at the origin ----------------------------------------------------
  const floor = PLINTH + 0.015;
  b.section("linga");
  b.box(-0.45, 0.45, floor, floor + 0.25, -0.45, 0.45, C.pitha);
  b.add(new CylinderGeometry(0.42, 0.42, 0.1, 28), placed(0, floor + 0.3, 0), C.pitha);
  // The pitha's spout points north, towards the somasutra.
  b.add(new BoxGeometry(0.45, 0.06, 0.16), placed(0.62, floor + 0.31, 0), C.pitha);
  b.add(new CylinderGeometry(0.15, 0.16, 0.42, 24), placed(0, floor + 0.56, 0), C.linga);
  b.add(
    new SphereGeometry(0.15, 24, 10, 0, TAU, 0, Math.PI / 2),
    placed(0, floor + 0.77, 0),
    C.linga,
  );
  b.section(null);
  // Two sanctum lamps.
  for (const x of [-1.1, 1.1]) {
    b.add(new CylinderGeometry(0.03, 0.06, 0.72, 8), placed(x, floor + 0.36, 0.9), C.brass);
    b.add(new CylinderGeometry(0.09, 0.05, 0.05, 10), placed(x, floor + 0.74, 0.9), C.brass);
    addLamp(x, floor + 0.81, 0.9, 0.05);
  }

  // --- Somasutra: channel to the forest edge, optional bridge (the spout is with the shrine) -------
  b.box(2.95, 3.45, 0, 0.12, -0.32, 0.32, C.channel);
  b.box(3.45, SOMASUTRA.x1, 0, 0.1, 0.13, 0.3, C.channel);
  b.box(3.45, SOMASUTRA.x1, 0, 0.1, -0.3, -0.13, C.channel);
  b.box(3.45, SOMASUTRA.x1, 0, 0.03, -0.13, 0.13, C.groove);
  b.box(SOMASUTRA.x1, SOMASUTRA.x1 + 0.7, 0, 0.05, -0.45, 0.45, C.groove);
  if (opts.mode === "full") {
    b.box(
      SOMASUTRA_BRIDGE.x0,
      SOMASUTRA_BRIDGE.x1,
      0,
      0.14,
      SOMASUTRA_BRIDGE.z0,
      SOMASUTRA_BRIDGE.z1,
      C.stone,
    );
  }

  // --- Mandapa ------------------------------------------------------------------------------------
  b.section("mandapa");
  b.box(MANDAPA.x0, MANDAPA.x1, 0, PLINTH, MANDAPA.z0, MANDAPA.z1, C.plinth);
  b.box(MANDAPA.x0 - 0.15, MANDAPA.x1 + 0.15, 0, 0.14, MANDAPA.z0 - 0.15, MANDAPA.z1, C.moulding);
  // The clear central aisle (the Nandi axis) is a slightly paler stone.
  b.box(NANDI_AXIS.x0, NANDI_AXIS.x1, PLINTH, PLINTH + 0.008, MANDAPA.z0, MANDAPA.z1, C.aisle);
  b.box(MANDAPA.x0, MANDAPA.x1, 0, 0.3, MANDAPA.z1, MANDAPA.z1 + 0.34, C.plinth);
  b.box(MANDAPA.x0, MANDAPA.x1, 0, 0.15, MANDAPA.z1 + 0.34, MANDAPA.z1 + 0.67, C.plinth);
  for (const p of MANDAPA_PILLARS) {
    b.box(p.x - 0.29, p.x + 0.29, PLINTH, PLINTH + 0.18, p.z - 0.29, p.z + 0.29, C.stoneDark);
    b.add(
      new CylinderGeometry(0.22, 0.25, 3.2, 8),
      placed(p.x, PLINTH + 0.18 + 1.6, p.z, Math.PI / 8),
      C.stone,
      true,
    );
    b.box(p.x - 0.36, p.x + 0.36, 3.83, HEIGHTS.pillarTop, p.z - 0.36, p.z + 0.36, C.stoneDark);
  }
  b.box(6.28, 6.72, 4.2, 4.42, 5.4, 18.8, C.stoneDark);
  b.box(-6.72, -6.28, 4.2, 4.42, 5.4, 18.8, C.stoneDark);
  for (const z of [5.6, 10, 14.4, 18.6])
    b.box(-6.72, 6.72, 4.2, 4.42, z - 0.2, z + 0.2, C.stoneDark);
  b.box(-7.6, 7.6, 4.42, 4.7, 4.6, 19.8, C.stone);
  b.box(-6.5, 6.5, 4.7, 5.05, 5.8, 18.6, C.stoneDark);
  b.box(-5.1, 5.1, 5.05, 5.4, 7.2, 17.2, C.stone);
  b.box(-3.5, 3.5, 5.4, 5.75, 8.8, 15.6, C.stoneDark);
  b.add(kalasha(), placed(0, 5.75, 12.2, 0, 0.6), C.brass);
  b.section(null);
  // Lamp brackets stay with the lamps, which are drawn in code.
  for (const p of MANDAPA_PILLARS.filter((q) => Math.abs(q.x) > 6)) {
    const out = Math.sign(p.x);
    b.box(p.x + out * 0.25, p.x + out * 0.45, 3.42, 3.48, p.z - 0.03, p.z + 0.03, C.woodDark);
    addLamp(p.x + out * 0.45, 3.3, p.z);
  }

  // --- Nandi on his platform (plain stone placeholder, facing the sanctum) ---------------------
  b.box(
    NANDI_PLATFORM.x0,
    NANDI_PLATFORM.x1,
    0,
    0.5,
    NANDI_PLATFORM.z0,
    NANDI_PLATFORM.z1,
    C.stone,
  );
  b.box(
    NANDI_PLATFORM.x0 - 0.1,
    NANDI_PLATFORM.x1 + 0.1,
    0,
    0.12,
    NANDI_PLATFORM.z0 - 0.1,
    NANDI_PLATFORM.z1 + 0.1,
    C.stoneDark,
  );
  b.section("nandi");
  b.box(-0.36, 0.36, 0.5, 1.08, 21.55, 22.85, C.sacredStone);
  b.box(-0.24, 0.24, 1.08, 1.2, 21.75, 22.05, C.sacredStone);
  b.box(-0.2, 0.2, 0.9, 1.4, 21.25, 21.62, C.sacredStone);
  b.section(null);

  // --- Deepa stand and aarti plate stand ------------------------------------------------------
  const ds = DEEPA_STAND;
  b.section("deepa-stand");
  b.add(new CylinderGeometry(0.8, 0.8, 0.22, 20), placed(ds.x, 0.11, ds.z), C.stoneDark);
  b.add(new CylinderGeometry(0.1, 0.14, 2, 10), placed(ds.x, 1.22, ds.z), C.brass);
  for (const [y, r] of [
    [0.7, 0.72],
    [1.15, 0.58],
    [1.6, 0.44],
    [2.0, 0.3],
  ] as const) {
    b.add(new CylinderGeometry(r, r * 0.92, 0.05, 20), placed(ds.x, y, ds.z), C.brass);
  }
  b.add(new SphereGeometry(0.07, 10, 6), placed(ds.x, 2.28, ds.z), C.brass);
  b.section("aarti-plate");
  b.add(
    new CylinderGeometry(0.12, 0.2, 0.85, 10),
    placed(AARTI_PLATE.x, 0.425, AARTI_PLATE.z),
    C.wood,
  );
  b.add(
    new CylinderGeometry(0.24, 0.2, 0.04, 14),
    placed(AARTI_PLATE.x, 0.87, AARTI_PLATE.z),
    C.brass,
  );
  b.section(null);

  // --- Ganesha shrine (plain stone placeholder murti, facing +x) -------------------------------
  const gs = GANESHA_SHRINE;
  b.section("ganesha-shrine");
  b.box(gs.x0, gs.x1, 0, 0.4, gs.z0, gs.z1, C.plinth);
  b.box(gs.x0, gs.x0 + 0.3, 0.4, 2.3, gs.z0, gs.z1, C.stone);
  b.box(gs.x0 + 0.3, gs.x1, 0.4, 2.3, gs.z0, gs.z0 + 0.25, C.stone);
  b.box(gs.x0 + 0.3, gs.x1, 0.4, 2.3, gs.z1 - 0.25, gs.z1, C.stone);
  b.box(gs.x0 - 0.15, gs.x1 + 0.15, 2.3, 2.5, gs.z0 - 0.15, gs.z1 + 0.15, C.stoneDark);
  b.add(
    tower([
      [1.0, 0],
      [0.92, 0.35],
      [0.7, 0.7],
      [0.42, 0.95],
      [0.25, 1.05],
    ]),
    placed((gs.x0 + gs.x1) / 2, 2.5, (gs.z0 + gs.z1) / 2, Math.PI / 4),
    C.shikhara,
    true,
  );
  b.add(kalasha(), placed((gs.x0 + gs.x1) / 2, 3.55, (gs.z0 + gs.z1) / 2, 0, 0.35), C.brass);
  const gz = GANESHA.z;
  b.box(-5.75, -5.05, 0.4, 0.75, gz - 0.4, gz + 0.4, C.stoneDark);
  b.section("ganesha");
  b.box(-5.6, -5.15, 0.75, 1.3, gz - 0.24, gz + 0.24, C.sacredStone);
  b.box(-5.55, -5.2, 1.3, 1.46, gz - 0.16, gz + 0.16, C.sacredStone);
  b.section(null);
  addLamp(-4.95, 0.82, gz - 0.3, 0.05);
  addLamp(-4.95, 0.82, gz + 0.3, 0.05);

  // --- Gate (torana), boundary wall and today board ---------------------------------------------
  b.section("gate");
  for (const p of GATE_PILLARS) {
    b.add(
      new CylinderGeometry(0.3, 0.38, 3.3, 8),
      placed(p.x, 1.65, p.z, Math.PI / 8),
      C.stone,
      true,
    );
    b.box(p.x - 0.45, p.x + 0.45, 3.18, 3.32, p.z - 0.45, p.z + 0.45, C.stoneDark);
    // On a small shelf on the pillar's inner, temple-side corner (the gate model carves it).
    addLamp(p.x - Math.sign(p.x) * 0.42, 2.45, p.z - 0.24);
  }
  b.box(-2.6, 2.6, 3.3, 3.62, GATE.z - 0.18, GATE.z + 0.18, C.stoneDark);
  b.box(-2.8, 2.8, 3.62, 3.75, GATE.z - 0.25, GATE.z + 0.25, C.stone);
  b.add(
    tower([
      [0.42, 0],
      [0.38, 0.3],
      [0.26, 0.55],
      [0.12, 0.7],
    ]),
    placed(GATE.x, 3.75, GATE.z, Math.PI / 4),
    C.shikhara,
    true,
  );
  b.section(null);
  for (const w of GATE_WALLS) {
    b.box(w.x0, w.x1, 0, 1.3, w.z0 + 0.05, w.z1 - 0.05, C.stone);
    b.box(w.x0, w.x1, 1.3, 1.4, w.z0, w.z1, C.stoneDark);
  }

  const tb = TODAY_BOARD;
  b.section("today-board");
  b.box(tb.x - 0.06, tb.x + 0.06, 0, 1.95, tb.z - 0.75, tb.z - 0.63, C.woodDark);
  b.box(tb.x - 0.06, tb.x + 0.06, 0, 1.95, tb.z + 0.63, tb.z + 0.75, C.woodDark);
  b.box(tb.x - 0.05, tb.x + 0.05, 1.0, 1.85, tb.z - 0.8, tb.z + 0.8, C.wood);
  b.box(tb.x - 0.065, tb.x - 0.05, 1.06, 1.79, tb.z - 0.72, tb.z + 0.72, C.board);
  b.box(tb.x - 0.2, tb.x + 0.25, 1.95, 2.02, tb.z - 0.9, tb.z + 0.9, C.woodDark);
  b.section(null);

  // --- Bells: chains and the frames that hold the path bells ------------------------------------
  const hangs = bellHangs();
  for (const id of ["gate", "mandapa-n", "mandapa-s"] as const) {
    const h = hangs[id];
    const top = id === "gate" ? 3.3 : 4.42;
    b.box(h.x - 0.015, h.x + 0.015, h.y, top, h.z - 0.015, h.z + 0.015, C.woodDark);
  }
  // A post just off the path, with an arm out over it and a shelf facing the path. The lamp on
  // the shelf is the post-lamp slot (an instanced mesh below); its flame is drawn here.
  const posts = pathPosts();
  const lampHeight = SLOTS["post-lamp"].fit.size;
  for (const { id, x: px, z, side } of posts) {
    const h = hangs[id];
    b.box(px - 0.06, px + 0.06, 0, 2.75, z - 0.06, z + 0.06, C.woodDark);
    b.box(
      Math.min(px, h.x) - 0.04,
      Math.max(px, h.x) + 0.04,
      2.6,
      2.68,
      z - 0.04,
      z + 0.04,
      C.woodDark,
    );
    b.box(h.x - 0.015, h.x + 0.015, h.y, 2.6, z - 0.015, z + 0.015, C.woodDark);
    const face = px - side * 0.06;
    const edge = px - side * (POST_LAMP_OUT + 0.12);
    const brace = px - side * 0.2;
    b.box(
      Math.min(face, edge),
      Math.max(face, edge),
      POST_SHELF_TOP - 0.04,
      POST_SHELF_TOP,
      z - 0.12,
      z + 0.12,
      C.woodDark,
    );
    b.box(
      Math.min(face, brace),
      Math.max(face, brace),
      POST_SHELF_TOP - 0.16,
      POST_SHELF_TOP - 0.04,
      z - 0.025,
      z + 0.025,
      C.woodDark,
    );
    addLamp(px - side * POST_LAMP_OUT, POST_SHELF_TOP + lampHeight + 0.03, z, 0.05);
  }

  // --- Far snow peaks (generic shapes, no real mountain) -----------------------------------------
  const rng = mulberry32(2026);
  const rock = new Color(C.rock);
  const snow = new Color(C.snow);
  for (let i = 0; i < 18; i++) {
    const west = i < 14;
    const az = west ? Math.PI + (rng() - 0.5) * 2.7 : rng() * TAU;
    const dist = 380 + rng() * 200;
    const height = 110 + rng() * 160;
    const radius = 150 + rng() * 90;
    const base = -30;
    const line = base + height * (0.5 + rng() * 0.15);
    b.addShaded(
      new ConeGeometry(radius, height, 7, 3),
      placed(Math.sin(az) * dist, base + height / 2, Math.cos(az) * dist, rng() * TAU),
      (_x, y, _z, out) => {
        out.copy(y > line ? snow : rock);
      },
    );
  }

  // --- Meshes -------------------------------------------------------------------------------------
  const group = new Group();
  const worldMat = new MeshLambertMaterial({ vertexColors: true });
  const ground = new Mesh(b.build(), worldMat);
  ground.name = "greybox";
  const runs = b.sections();
  const tapMesh = new Mesh(ground.geometry, worldMat);
  const sections = new Set(runs.keys() as Iterable<SlotId>);
  group.add(ground);

  const lampMaterial = new MeshBasicMaterial({ vertexColors: true });
  const lampMesh = new Mesh(lamps.build(), lampMaterial);
  group.add(lampMesh);

  const glowMaterial = new PointsMaterial({
    size: 0.9,
    map: glowTexture(),
    color: C.lamp,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const glowGeo = new BufferGeometry();
  glowGeo.setAttribute("position", new Float32BufferAttribute(glow, 3));
  group.add(new Points(glowGeo, glowMaterial));

  const water = new Mesh(
    new PlaneGeometry(KUND_WATER.x1 - KUND_WATER.x0, KUND_WATER.z1 - KUND_WATER.z0),
    new MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.86 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(
    (KUND_WATER.x0 + KUND_WATER.x1) / 2,
    KUND_WATER_Y,
    (KUND_WATER.z0 + KUND_WATER.z1) / 2,
  );
  group.add(water);

  const m = new Matrix4();
  // Instanced shapes have their origin where a slot model's goes: the bottom centre (bells: top).
  const mats = new InstancedMesh(
    new BoxGeometry(0.7, 0.025, 0.8).translate(0, 0.0125, 0),
    new MeshLambertMaterial({ color: C.mat }),
    MATS.length,
  );
  MATS.forEach((mat, i) => mats.setMatrixAt(i, m.makeTranslation(mat.x, PLINTH, mat.z)));
  mats.name = "mats";
  group.add(mats);

  const bellHang = bellHangs();
  const bells = new InstancedMesh(
    bellGeometry(),
    new MeshLambertMaterial({ color: C.brass }),
    BELL_IDS.length,
  );
  BELL_IDS.forEach((id, i) => {
    const h = bellHang[id];
    bells.setMatrixAt(i, placed(h.x, h.y, h.z, 0, h.scale));
  });
  bells.name = "bells";
  group.add(bells);

  // Each lamp faces the path (a model's front is +z).
  const postLamps = new InstancedMesh(
    postLampGeometry(),
    new MeshLambertMaterial({ color: C.brass }),
    posts.length,
  );
  posts.forEach((p, i) => {
    const yaw = (-p.side * Math.PI) / 2;
    postLamps.setMatrixAt(i, placed(p.x - p.side * POST_LAMP_OUT, POST_SHELF_TOP, p.z, yaw));
  });
  postLamps.name = "post-lamps";
  group.add(postLamps);

  const { far: trees, near: nearTrees, oaks } = buildTrees();
  const farAvailable = trees.count;
  const nearAvailable = nearTrees.count;
  const oakAvailable = oaks.count;
  const showCount = (mesh: InstancedMesh, count: number): void => {
    if (mesh.count === count) return;
    mesh.count = count;
    // Bounds are cached per count; a stale sphere could cull every tree at once.
    mesh.boundingSphere = null;
  };
  const setTrees = (total: number, tier: AssetTier): void => {
    const near = Math.min(nearAvailable, SLOTS["near-tree"].copies?.[tier] ?? 0, total);
    const oak = Math.min(oakAvailable, SLOTS.oak.copies?.[tier] ?? 0, total - near);
    showCount(nearTrees, near);
    showCount(oaks, oak);
    showCount(trees, Math.min(farAvailable, Math.max(0, total - near - oak)));
  };
  setTrees(opts.trees, opts.treeTier ?? "full");
  group.add(trees, nearTrees, oaks);

  return {
    group,
    ground,
    tapMesh,
    mats,
    bells,
    bellHang,
    postLamps,
    trees,
    nearTrees,
    oaks,
    setTrees,
    lampMaterial,
    glowMaterial,
    shadowCasters: [ground, trees, nearTrees, oaks, bells, postLamps],
    sections,
    hide(slot) {
      if (!sections.delete(slot)) return;
      const next = withoutSection(ground.geometry, runs, slot);
      // Frees only the GPU copy; the tap mesh keeps the first geometry's arrays for raycasts.
      ground.geometry.dispose();
      ground.geometry = next;
    },
    dispose() {
      tapMesh.geometry.dispose();
      group.traverse((o) => {
        if (o instanceof Mesh || o instanceof Points) {
          const mesh = o as Mesh<BufferGeometry, Material | Material[]>;
          mesh.geometry.dispose();
          for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            const maps = mt as Material &
              Partial<Record<"map" | "emissiveMap" | "alphaMap", Texture | null>>;
            maps.map?.dispose();
            maps.emissiveMap?.dispose();
            maps.alphaMap?.dispose();
            mt.dispose();
          }
          // Instance matrices and colours live in their own GPU buffers.
          if (o instanceof InstancedMesh) o.dispose();
        }
      });
    },
  };
}

/** How far a point outside a walkable shape is from its edge (0 inside). */
function shapeDistance(s: WorldShape, x: number, z: number): number {
  switch (s.kind) {
    case "rect":
      return Math.hypot(Math.max(s.x0 - x, 0, x - s.x1), Math.max(s.z0 - z, 0, z - s.z1));
    case "circle":
      return Math.max(0, Math.hypot(x - s.x, z - s.z) - s.r);
    case "capsule": {
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / (sx * sx + sz * sz)));
      return Math.max(0, Math.hypot(x - (s.ax + t * sx), z - (s.az + t * sz)) - s.r);
    }
  }
}

type TreeKind = "deodar" | "oak";

interface TreeSpot {
  kind: TreeKind;
  x: number;
  z: number;
  /** Scale across (x), across the other way (z) and up (y), from the tree's age and shape. */
  w: number;
  d: number;
  h: number;
  yaw: number;
  /** A slight lean off upright (radians), and which way. */
  lean: number;
  leanDir: number;
  /** Instance colour: brightness, and a slight lean towards yellow-green (+) or blue-green (−). */
  tint: number;
  warmth: number;
}

/**
 * Pulls a round shape's outline in and out with the direction round its axis (and a little with
 * height), so cones and balls come out uneven. The same point always moves the same way, so seams
 * stay closed, and it only ever pulls in, so a tree's spread still holds.
 */
function uneven(geometry: BufferGeometry, amp: number, phase: number): BufferGeometry {
  const p = geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const a = Math.atan2(z, x);
    const s =
      0.5 +
      0.25 * Math.sin(3 * a + phase) * Math.cos((4 * y) / len - phase) +
      0.25 * Math.sin(5 * a + 2.1 * phase + y);
    const k = 1 - amp * s;
    p.setXYZ(i, x * k, y, z * k);
  }
  return geometry;
}

/**
 * A deodar: tiers of drooping branches. The tiers sit a little off the trunk and are uneven at
 * the edge, and the top bends over as a deodar's leading shoot does, so trees turned different
 * ways don't look alike. The lowest tier stays centred, so the spread holds.
 */
function deodarGeometry(): BufferGeometry {
  const t = new MeshBuilder();
  t.add(new CylinderGeometry(0.16, 0.28, 3.2, 6), placed(0, 1.6, 0), COLOURS.trunk, true);
  // Radius, height, centre height, offset x and z, colour.
  const tiers: [number, number, number, number, number, string][] = [
    [TREE_SPREAD, 3.6, 3.6, 0, 0, "#2c4630"],
    [2.1, 3.2, 5.6, -0.22, 0.12, "#33503a"],
    [1.55, 2.9, 7.4, 0.14, 0.24, "#2f4b34"],
    [0.95, 2.6, 9.1, 0.05, -0.1, "#375640"],
  ];
  tiers.forEach(([r, h, y, dx, dz, c], i) => {
    const m = new Matrix4().makeTranslation(dx, y, dz);
    if (i === tiers.length - 1) m.multiply(new Matrix4().makeRotationZ(-0.2));
    t.add(uneven(new ConeGeometry(r, h, 9), 0.16, i * 1.7), m, c, true);
  });
  return t.build();
}

/**
 * A Himalayan oak (banj): a short trunk forking into two limbs under a broad, lumpy, rounded
 * crown, darker and greyer than the deodars. Every lump stays within the tree's spread.
 */
function oakGeometry(): BufferGeometry {
  const t = new MeshBuilder();
  t.add(new CylinderGeometry(0.2, 0.34, 2.8, 6), placed(0, 1.4, 0), COLOURS.trunk, true);
  const limbs: [number, number][] = [
    [0.4, 0.42],
    [3.6, 0.36],
  ];
  for (const [dir, tilt] of limbs) {
    const m = new Matrix4()
      .makeTranslation(0, 2.6, 0)
      .multiply(new Matrix4().makeRotationY(dir))
      .multiply(new Matrix4().makeRotationZ(tilt))
      .multiply(new Matrix4().makeTranslation(0, 0.9, 0));
    t.add(new CylinderGeometry(0.1, 0.17, 1.8, 5), m, COLOURS.trunk, true);
  }
  // Centre x, y, z, radius, colour.
  const lumps: [number, number, number, number, string][] = [
    [0, 5.4, 0, 2.1, "#3f5434"],
    [1.0, 4.9, 0.45, 1.45, "#465b39"],
    [-0.95, 5.1, -0.55, 1.5, "#3b4f31"],
    [-0.3, 4.7, 1.05, 1.35, "#435836"],
    [0.55, 5.2, -1.05, 1.3, "#4a5e3b"],
    [0.2, 6.5, -0.15, 1.35, "#41573a"],
  ];
  lumps.forEach(([x, y, z, r, c], i) => {
    const m = new Matrix4().makeTranslation(x, y, z).scale(new Vector3(1, 0.85, 1));
    t.add(uneven(new IcosahedronGeometry(r, 1), 0.22, i * 2.3), m, c, true);
  });
  return t.build();
}

/**
 * Deodars and Himalayan oaks outside the walkable area, grown the way a hillside forest grows
 * (spec 02 § Setting): stands of trees at uneven steps and distances round the temple, so the
 * forest is thick one way and opens into clearings another, with trees on their own between them
 * and a few a little way off the paths, on whichever side they fall. Oaks grow together in their
 * own stands; the other stands are mostly deodar. Most are grown trees, some are young and
 * slender, and a few old, broad giants stand back from the paths. The deodars closest to where
 * visitors walk are the near trees (closest first, so Lite keeps the first of them); the other
 * deodars and the oaks are nearest the temple first, so Lite can keep the first of those.
 */
function buildTrees(): { far: InstancedMesh; near: InstancedMesh; oaks: InstancedMesh } {
  const rng = mulberry32(108);
  const centre = { x: 0, z: 24 };
  const toPath = (x: number, z: number): number => {
    let d = Infinity;
    for (const s of WALKABLE) d = Math.min(d, shapeDistance(s, x, z));
    return d;
  };
  const ring = (r0: number, r1: number): { x: number; z: number } => {
    const a = rng() * TAU;
    const r = r0 + Math.sqrt(rng()) * (r1 - r0);
    return { x: centre.x + Math.sin(a) * r, z: centre.z + Math.cos(a) * r * 1.15 };
  };

  const groves: { x: number; z: number; r: number; oak: number; weight: number }[] = [];
  const start = rng() * TAU;
  for (let a = start; a < start + TAU - 0.3; a += 0.35 + rng() * 0.8) {
    for (let tries = 0; tries < 20; tries++) {
      const r = 16 + rng() * 55;
      const x = centre.x + Math.sin(a) * r;
      const z = centre.z + Math.cos(a) * r * 1.15;
      if (toPath(x, z) < 5) continue;
      const size = 5 + rng() ** 1.5 * 13;
      groves.push({ x, z, r: size, oak: rng() < 0.4 ? 0.8 : 0.12, weight: size * (0.5 + rng()) });
      break;
    }
  }
  const groveWeight = groves.reduce((n, g) => n + g.weight, 0);
  const pickGrove = (): (typeof groves)[number] | undefined => {
    let u = rng() * groveWeight;
    for (const g of groves) {
      u -= g.weight;
      if (u <= 0) return g;
    }
    return groves[groves.length - 1];
  };

  const oakQuota = SLOTS.oak.copies?.full ?? 0;
  const quota: Record<TreeKind, number> = { deodar: MAX_TREES - oakQuota, oak: oakQuota };
  const grown: Record<TreeKind, number> = { deodar: 0, oak: 0 };
  const spots: TreeSpot[] = [];
  // A few hundred tries fill the forest today. The cap bounds the boot cost if a change to the
  // paths or the spacing ever makes room scarce; the forest test then finds fewer than MAX_TREES.
  for (let tries = 0; spots.length < MAX_TREES && tries < 5000; tries++) {
    let x: number;
    let z: number;
    let oakShare: number;
    let room: number;
    const where = rng();
    const grove = where < 0.6 ? pickGrove() : undefined;
    if (grove) {
      // Denser towards the middle of the stand, thinning out at its edge; close together.
      const a = rng() * TAU;
      const d = grove.r * 0.55 * Math.sqrt(-2 * Math.log(1 - rng() * 0.95));
      x = grove.x + Math.sin(a) * d;
      z = grove.z + Math.cos(a) * d;
      oakShare = grove.oak;
      room = 0.55 + rng() * 0.15;
    } else if (where < 0.82) {
      // On its own, with room round it.
      ({ x, z } = ring(10, 80));
      oakShare = 0.35;
      room = 0.75;
    } else {
      // A little way off a path.
      ({ x, z } = ring(6, 45));
      if (toPath(x, z) > 9) continue;
      oakShare = 0.3;
      room = 0.7;
    }
    if (Math.abs(x) < 8 && z > GATE.z - 1 && z < GATE.z + 22) continue; // keep the gate in view
    let kind: TreeKind = rng() < oakShare ? "oak" : "deodar";
    if (grown[kind] >= quota[kind]) kind = kind === "oak" ? "deodar" : "oak";
    const oak = kind === "oak";

    // A few young trees, mostly grown ones, and some old giants.
    const age = rng();
    const young = age < 0.22;
    const old = age >= 0.82;
    const s = young ? 0.42 + rng() * 0.25 : old ? 1.25 + rng() * 0.3 : 0.75 + rng() * 0.4;
    // Young trees are slender; old ones spread wide, the oaks most.
    const w = s * (young ? 0.85 : old ? (oak ? 1.15 : 1.08) : 1) * (0.92 + rng() * 0.16);
    const d = w * (0.88 + rng() * 0.24); // a little oval from above
    const h = s * (oak ? 0.85 + rng() * 0.25 : 0.9 + rng() * 0.2);
    // Oaks lean a little; deodars grow almost straight.
    const lean = rng() * (oak ? 0.05 : 0.018);
    const leanDir = rng() * TAU;
    // How far the widest branches reach, leaning (they are about 5.2 m up an oak, 3.6 m a deodar).
    const size = TREE_SPREAD * Math.max(w, d);
    const reach = size + (oak ? 5.2 : 3.6) * h * Math.sin(lean);
    const gap = toPath(x, z);
    // Branches stay off the paths and the compound; the giants stand well back.
    if (gap < reach + 0.3 || (old && gap < 12)) continue;
    if (TREES_KEEP_CLEAR.some((k) => shapeDistance(k.shape, x, z) < Math.max(reach + k.gap, k.trunk)))
      continue;
    if (
      spots.some(
        (p) => Math.hypot(p.x - x, p.z - z) < room * (TREE_SPREAD * Math.max(p.w, p.d) + size),
      )
    )
      continue;
    const tint = young ? 0.95 + rng() * 0.15 : old ? 0.78 + rng() * 0.15 : 0.85 + rng() * 0.2;
    spots.push({ kind, x, z, w, d, h, yaw: rng() * TAU, lean, leanDir, tint, warmth: rng() * 2 - 1 });
    grown[kind]++;
  }
  spots.sort(
    (p, q) =>
      Math.hypot(p.x - centre.x, p.z - centre.z) - Math.hypot(q.x - centre.x, q.z - centre.z),
  );
  const deodars = spots.filter((p) => p.kind === "deodar");
  const byPath = deodars
    .map((p, i) => ({ i, d: toPath(p.x, p.z) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, SLOTS["near-tree"].copies?.full ?? 0);
  const nearIds = new Set(byPath.map((e) => e.i));
  // The near-tree model stands straight and round, as wide as it was fitted.
  const nearSpots = byPath
    .map((e) => deodars[e.i])
    .filter((p) => p !== undefined)
    .map((p) => ({ ...p, d: p.w, lean: 0 }));
  const farSpots = deodars.filter((_, i) => !nearIds.has(i));
  const oakSpots = spots.filter((p) => p.kind === "oak");

  const c = new Color();
  const m = new Matrix4();
  const turn = new Matrix4();
  const v = new Vector3();
  const make = (name: string, list: TreeSpot[], geo: BufferGeometry, maxScale: number) => {
    const mesh = new InstancedMesh(
      geo,
      new MeshLambertMaterial({ vertexColors: true }),
      list.length,
    );
    mesh.name = name;
    list.forEach((p, i) => {
      // A capped tree keeps its shape, only smaller.
      const k = Math.min(1, maxScale / Math.max(p.w, p.d));
      m.makeRotationAxis(v.set(Math.cos(p.leanDir), 0, Math.sin(p.leanDir)), p.lean)
        .multiply(turn.makeRotationY(p.yaw))
        .scale(v.set(p.w * k, p.h * k, p.d * k))
        .setPosition(p.x, 0, p.z);
      mesh.setMatrixAt(i, m);
      const warm = (p.kind === "oak" ? 0.07 : 0.04) * p.warmth;
      mesh.setColorAt(i, c.setRGB(p.tint * (1 + warm), p.tint, p.tint * (1 - warm)));
    });
    mesh.count = list.length;
    return mesh;
  };
  const deodar = deodarGeometry();
  // Each mesh has its own geometry: a model replacing one disposes it.
  return {
    far: make("trees", farSpots, deodar, Infinity),
    near: make("near-trees", nearSpots, deodar.clone(), NEAR_TREE_MAX_SCALE),
    oaks: make("oaks", oakSpots, oakGeometry(), Infinity),
  };
}

/** A soft round glow for lamp sprites. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,240,200,1)");
  grad.addColorStop(0.25, "rgba(255,200,120,0.55)");
  grad.addColorStop(1, "rgba(255,170,80,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
