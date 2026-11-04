/**
 * The M1 greybox (spec 02 § Layout and § Greybox details): blockout shapes for every element of the
 * temple, built in code from world.ts. Final art (M5) replaces these through the asset manifest.
 *
 * Placeholders for the sacred forms are deliberately plain (spec 08 § Depiction): the linga is a
 * simple dark stone form on its pitha; Nandi is plain stone blocks that only suggest the seated
 * form and its facing; the Ganesha murti is an unadorned stone mass. None has a face. All are
 * replaced by the human-made, advisor-reviewed assets.
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
  type Material,
  type Texture,
} from "three";
import {
  ANTARALA,
  AARTI_PLATE,
  BELLS,
  BELL_IDS,
  COMPOUND,
  COURTYARD,
  DEEPA_STAND,
  GANESHA_SHRINE,
  GATE_PATH,
  GATE_PATH_HALF_WIDTH,
  GATE_PILLARS,
  FOOTWEAR_RACK,
  INSTANCE_CAPACITY,
  KUND,
  KUND_WATER,
  MANDAPA,
  MANDAPA_PILLARS,
  MATS,
  NANDI_AXIS,
  NANDI_PLATFORM,
  PRADAKSHINA,
  SANCTUM_DOOR,
  SOMASUTRA,
  SOMASUTRA_BRIDGE,
  TODAY_BOARD,
  WALKABLE,
  type BellId,
  type PradakshinaMode,
  type Shape as WorldShape,
} from "@sannidhi/protocol";
import { MeshBuilder, placed } from "./builder";
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
  chappal: "#3b2a20",
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
  /** Raycast target for tap-to-walk: the floors and everything solid. */
  ground: Mesh;
  mats: InstancedMesh;
  /** One instance per bell, in BELL_IDS order; their matrices swing when rung (scene/bells.ts). */
  bells: InstancedMesh;
  bellHang: Record<BellId, { x: number; y: number; z: number; scale: number }>;
  trees: InstancedMesh;
  /** How many trees were placed; Lite shows the nearest 120 of them (spec 11). */
  treesAvailable: number;
  footwear: InstancedMesh;
  /** Lamp bodies; their colour is scaled by the time of day. */
  lampMaterial: MeshBasicMaterial;
  glowMaterial: PointsMaterial;
  /** Every mesh that should cast and receive the High-tier shadow. */
  shadowCasters: (Mesh | InstancedMesh)[];
  dispose(): void;
}

export interface GreyboxOptions {
  mode: PradakshinaMode;
  trees: number;
  footwearPairs: number;
}

export const MAX_TREES = 300;

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
  b.box(-2.6, 2.6, 0, PAVING, 54.4, 58.3, C.court); // inside the gate
  b.box(-4.3, -0.5, 0, PAVING, 50.6, 53.4, C.court); // before the Ganesha shrine
  b.box(-1.8, 1.8, 0, PAVING, 58.3, 72, C.court); // the approach outside the gate

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

  // --- Garbhagriha, antarala and shikhara -------------------------------------------------------
  const wallTop = HEIGHTS.shrineWall;
  const door = SANCTUM_DOOR.halfWidth;
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

  // --- Linga on its yoni pitha, at the origin ----------------------------------------------------
  const floor = PLINTH + 0.015;
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
  // Two sanctum lamps.
  for (const x of [-1.1, 1.1]) {
    b.add(new CylinderGeometry(0.03, 0.06, 0.72, 8), placed(x, floor + 0.36, 0.9), C.brass);
    b.add(new CylinderGeometry(0.09, 0.05, 0.05, 10), placed(x, floor + 0.74, 0.9), C.brass);
    addLamp(x, floor + 0.81, 0.9, 0.05);
  }

  // --- Somasutra: spout, channel to the forest edge, optional bridge ------------------------------
  b.box(2.6, 3.15, PLINTH + 0.05, PLINTH + 0.17, -0.1, 0.1, C.stoneDark);
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
  b.box(-0.36, 0.36, 0.5, 1.08, 21.55, 22.85, C.sacredStone);
  b.box(-0.24, 0.24, 1.08, 1.2, 21.75, 22.05, C.sacredStone);
  b.box(-0.2, 0.2, 0.9, 1.4, 21.25, 21.62, C.sacredStone);

  // --- Deepa stand and aarti plate stand ------------------------------------------------------
  const ds = DEEPA_STAND;
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

  // --- Ganesha shrine (plain stone placeholder murti, facing +x) -------------------------------
  const gs = GANESHA_SHRINE;
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
  b.box(-5.75, -5.05, 0.4, 0.75, 51.6, 52.4, C.stoneDark);
  b.box(-5.6, -5.15, 0.75, 1.3, 51.76, 52.24, C.sacredStone);
  b.box(-5.55, -5.2, 1.3, 1.46, 51.84, 52.16, C.sacredStone);
  addLamp(-4.95, 0.82, 51.7, 0.05);
  addLamp(-4.95, 0.82, 52.3, 0.05);

  // --- Gate (torana), boundary wall, footwear rack and today board -----------------------------
  for (const p of GATE_PILLARS) {
    b.add(
      new CylinderGeometry(0.25, 0.3, 3.3, 8),
      placed(p.x, 1.65, p.z, Math.PI / 8),
      C.stone,
      true,
    );
    b.box(p.x - 0.34, p.x + 0.34, 3.18, 3.32, p.z - 0.34, p.z + 0.34, C.stoneDark);
    addLamp(p.x - Math.sign(p.x) * 0.36, 2.45, p.z - 0.2);
  }
  b.box(-2.6, 2.6, 3.3, 3.62, 57.82, 58.18, C.stoneDark);
  b.box(-2.8, 2.8, 3.62, 3.75, 57.75, 58.25, C.stone);
  b.add(
    tower([
      [0.42, 0],
      [0.38, 0.3],
      [0.26, 0.55],
      [0.12, 0.7],
    ]),
    placed(0, 3.75, 58, Math.PI / 4),
    C.shikhara,
    true,
  );
  b.box(2.6, 11, 0, 1.3, 58.05, 58.35, C.stone);
  b.box(-11, -2.6, 0, 1.3, 58.05, 58.35, C.stone);
  b.box(2.6, 11, 1.3, 1.4, 58.0, 58.4, C.stoneDark);
  b.box(-11, -2.6, 1.3, 1.4, 58.0, 58.4, C.stoneDark);

  const rack = FOOTWEAR_RACK;
  const rackX0 = rack.x - 1.8;
  const rackX1 = rack.x + 1.8;
  const rackZ0 = rack.z - 0.2;
  const rackZ1 = rack.z + 0.2;
  b.box(rackX0, rackX0 + 0.06, 0, 1.16, rackZ0, rackZ1, C.wood);
  b.box(rackX1 - 0.06, rackX1, 0, 1.16, rackZ0, rackZ1, C.wood);
  const shelves = [0.08, 0.36, 0.64, 0.92];
  for (const y of shelves) b.box(rackX0, rackX1, y, y + 0.03, rackZ0, rackZ1, C.wood);
  b.box(rackX0, rackX1, 1.13, 1.16, rackZ0, rackZ1, C.wood);

  const tb = TODAY_BOARD;
  b.box(tb.x - 0.06, tb.x + 0.06, 0, 1.95, tb.z - 0.75, tb.z - 0.63, C.woodDark);
  b.box(tb.x - 0.06, tb.x + 0.06, 0, 1.95, tb.z + 0.63, tb.z + 0.75, C.woodDark);
  b.box(tb.x - 0.05, tb.x + 0.05, 1.0, 1.85, tb.z - 0.8, tb.z + 0.8, C.wood);
  b.box(tb.x - 0.065, tb.x - 0.05, 1.06, 1.79, tb.z - 0.72, tb.z + 0.72, C.board);
  b.box(tb.x - 0.2, tb.x + 0.25, 1.95, 2.02, tb.z - 0.9, tb.z + 0.9, C.woodDark);

  // --- Bells: chains and the frames that hold the path bells ------------------------------------
  const hangs = bellHangs();
  for (const id of BELL_IDS) {
    const h = hangs[id];
    if (id === "gate") {
      b.box(h.x - 0.015, h.x + 0.015, h.y, 3.3, h.z - 0.015, h.z + 0.015, C.woodDark);
    } else if (id.startsWith("mandapa")) {
      b.box(h.x - 0.015, h.x + 0.015, h.y, 4.42, h.z - 0.015, h.z + 0.015, C.woodDark);
    } else {
      // A post just off the path, with an arm out over it.
      const side = Math.sign(h.x - gatePathX(h.z)) || 1;
      let px = h.x + side * 0.6;
      while (WALKABLE.some((s) => nearShape(s, px, h.z, 0.15))) px += side * 0.1;
      b.box(px - 0.06, px + 0.06, 0, 2.75, h.z - 0.06, h.z + 0.06, C.woodDark);
      b.box(
        Math.min(px, h.x) - 0.04,
        Math.max(px, h.x) + 0.04,
        2.6,
        2.68,
        h.z - 0.04,
        h.z + 0.04,
        C.woodDark,
      );
      b.box(h.x - 0.015, h.x + 0.015, h.y, 2.6, h.z - 0.015, h.z + 0.015, C.woodDark);
      addLamp(px - side * 0.12, 1.75, h.z);
    }
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
  const mats = new InstancedMesh(
    new BoxGeometry(0.7, 0.025, 0.8),
    new MeshLambertMaterial({ color: C.mat }),
    MATS.length,
  );
  MATS.forEach((mat, i) => mats.setMatrixAt(i, m.makeTranslation(mat.x, PLINTH + 0.0125, mat.z)));
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

  const pair = new MeshBuilder()
    .box(-0.115, -0.015, 0, 0.02, -0.13, 0.13, C.chappal)
    .box(0.015, 0.115, 0, 0.02, -0.13, 0.13, C.chappal)
    .build();
  const footwear = new InstancedMesh(
    pair,
    new MeshLambertMaterial({ vertexColors: true }),
    INSTANCE_CAPACITY,
  );
  const perShelf = Math.ceil(INSTANCE_CAPACITY / shelves.length);
  for (let i = 0; i < INSTANCE_CAPACITY; i++) {
    const shelf = shelves[Math.floor(i / perShelf)] ?? 0;
    const x = rackX0 + 0.2 + (i % perShelf) * ((rackX1 - rackX0 - 0.4) / (perShelf - 1));
    footwear.setMatrixAt(i, m.makeTranslation(x, shelf + 0.03, rack.z));
  }
  footwear.count = Math.min(INSTANCE_CAPACITY, Math.max(0, opts.footwearPairs));
  group.add(footwear);

  const trees = buildTrees();
  const treesAvailable = trees.count;
  trees.count = Math.min(treesAvailable, opts.trees);
  group.add(trees);

  return {
    group,
    ground,
    mats,
    bells,
    bellHang,
    trees,
    treesAvailable,
    footwear,
    lampMaterial,
    glowMaterial,
    shadowCasters: [ground, trees, bells],
    dispose() {
      group.traverse((o) => {
        if (o instanceof Mesh || o instanceof Points) {
          const mesh = o as Mesh<BufferGeometry, Material | Material[]>;
          mesh.geometry.dispose();
          for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            (mt as Material & { map?: Texture | null }).map?.dispose();
            mt.dispose();
          }
          // Instance matrices and colours live in their own GPU buffers.
          if (o instanceof InstancedMesh) o.dispose();
        }
      });
    },
  };
}

/** Deodars outside the walkable area, nearest the temple first so Lite can keep the first 120. */
function buildTrees(): InstancedMesh {
  const t = new MeshBuilder();
  t.add(new CylinderGeometry(0.16, 0.28, 3.2, 6), placed(0, 1.6, 0), COLOURS.trunk, true);
  const tiers: [number, number, number, string][] = [
    [2.6, 3.6, 3.6, "#2c4630"],
    [2.1, 3.2, 5.6, "#33503a"],
    [1.55, 2.9, 7.4, "#2f4b34"],
    [0.95, 2.6, 9.1, "#375640"],
  ];
  for (const [r, h, y, c] of tiers) t.add(new ConeGeometry(r, h, 8), placed(0, y, 0), c, true);
  const mesh = new InstancedMesh(
    t.build(),
    new MeshLambertMaterial({ vertexColors: true }),
    MAX_TREES,
  );
  mesh.name = "trees";

  const rng = mulberry32(108);
  const spots: { x: number; z: number; s: number; yaw: number; tint: number }[] = [];
  const centre = { x: 0, z: 24 };
  for (let tries = 0; spots.length < MAX_TREES && tries < 40000; tries++) {
    const a = rng() * TAU;
    const r = 8 + Math.sqrt(rng()) * 80;
    const x = centre.x + Math.sin(a) * r;
    const z = centre.z + Math.cos(a) * r * 1.15;
    const margin = (s: WorldShape): number => (s.kind === "capsule" ? 3.4 : 2.8);
    if (WALKABLE.some((s) => nearShape(s, x, z, margin(s)))) continue;
    if (Math.abs(x) < 8 && z > 57 && z < 80) continue; // keep the gate approach and rack in view
    if (spots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 3.4 * 3.4)) continue;
    spots.push({ x, z, s: 0.8 + rng() * 0.6, yaw: rng() * TAU, tint: 0.85 + rng() * 0.25 });
  }
  spots.sort(
    (p, q) =>
      Math.hypot(p.x - centre.x, p.z - centre.z) - Math.hypot(q.x - centre.x, q.z - centre.z),
  );
  const c = new Color();
  spots.forEach((p, i) => {
    mesh.setMatrixAt(i, placed(p.x, 0, p.z, p.yaw, p.s, p.s * (0.9 + (p.tint - 0.85)), p.s));
    mesh.setColorAt(i, c.setScalar(p.tint));
  });
  mesh.count = spots.length;
  return mesh;
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
