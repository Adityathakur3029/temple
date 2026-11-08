/**
 * The temple's floor plan, shared by the client (collision, tap-to-walk, the greybox scene) and
 * the server (movement rule, spec 05), so both agree on where a visitor may stand.
 * Source: specs/02-temple-world.md § Layout, § Sacred and blocked zones, § Pradakshina path and
 * § Greybox details. Change the spec and this file together.
 *
 * Metres. +x is north, +z is east, +y is up. The linga is at the origin and the shrine faces east.
 * Everything here is 2D (x, z): heights are the client's business.
 *
 * Yaw is in radians about +y. Yaw 0 faces +z (east) and yaw π/2 faces +x (north), so the facing
 * direction of yaw θ is (x, z) = (sin θ, cos θ). See `yawTowards`.
 */
import { PRADAKSHINA_MODE, type PradakshinaMode } from "./constants";
import { POSES, type BellId } from "./messages";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly z: number;
}

/** A point plus the way a visitor faces there. */
export interface Spot extends Point {
  readonly yaw: number;
}

export interface Rect {
  readonly kind: "rect";
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

export interface Circle {
  readonly kind: "circle";
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Every point within `r` of the segment a → b. Used for the gate path. */
export interface Capsule {
  readonly kind: "capsule";
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly r: number;
}

export type Shape = Rect | Circle | Capsule;

export function rect(x0: number, x1: number, z0: number, z1: number): Rect {
  return { kind: "rect", x0, x1, z0, z1 };
}

export function circle(x: number, z: number, r: number): Circle {
  return { kind: "circle", x, z, r };
}

export function capsule(a: Point, b: Point, r: number): Capsule {
  return { kind: "capsule", ax: a.x, az: a.z, bx: b.x, bz: b.z, r };
}

/** Edges count as inside. Non-finite coordinates are never inside anything. */
export function inShape(s: Shape, x: number, z: number): boolean {
  switch (s.kind) {
    case "rect":
      return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
    case "circle": {
      const dx = x - s.x;
      const dz = z - s.z;
      return dx * dx + dz * dz <= s.r * s.r;
    }
    case "capsule": {
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const len2 = sx * sx + sz * sz;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / len2));
      const dx = x - (s.ax + t * sx);
      const dz = z - (s.az + t * sz);
      return dx * dx + dz * dz <= s.r * s.r;
    }
  }
}

/** Facing direction from one point towards another (see the yaw convention above). */
export function yawTowards(from: Point, to: Point): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------------------------------------------------------------------------
// Layout (spec 02 § Layout)
// ---------------------------------------------------------------------------

export const LINGA: Point = { x: 0, z: 0 };

/** Sanctum footprint, walls included. Never walkable; the camera can't enter it either. */
export const GARBHAGRIHA = rect(-2.6, 2.6, -2.6, 2.6);

/** The sanctum door, in the east wall (z = 2.6), centred on the axis. */
export const SANCTUM_DOOR = { z: 2.6, halfWidth: 0.75 } as const;

/** The short vestibule between the sanctum door and the mandapa. */
export const ANTARALA = rect(-2.6, 2.6, 2.6, 5);

/** The open pillared hall, on a raised plinth reached by steps on its east side. */
export const MANDAPA = rect(-7, 7, 5, 19);

/** 12 pillars: four down each side, and two at each end framing the aisle. */
export const MANDAPA_PILLARS: readonly Point[] = [
  ...[5.6, 10, 14.4, 18.6].flatMap((z) => [
    { x: 6.5, z },
    { x: -6.5, z },
  ]),
  ...[5.6, 18.6].flatMap((z) => [
    { x: 2.9, z },
    { x: -2.9, z },
  ]),
];
export const PILLAR_HALF_SIZE = 0.25;

/** Nandi sits on a platform on the axis, facing the sanctum (−z). */
export const NANDI: Spot = { x: 0, z: 22, yaw: Math.PI };
export const NANDI_PLATFORM = rect(-1, 1, 21, 23);

/** The strip between Nandi and the sanctum. No standing, sitting or walking on it. */
export const NANDI_AXIS = rect(-1.2, 1.2, 0, 22);

export const COURTYARD = rect(-12, 12, 19, 30);

/** The 108-lamp tiered stand. */
export const DEEPA_STAND: Point = { x: -8.5, z: 25 };
export const DEEPA_STAND_RADIUS = 0.8;

/** Where visitors take aarti after the service. */
export const AARTI_PLATE: Point = { x: 2.2, z: 20.5 };

/** Stepped tank, centre (16, 32), 8 × 8 m. Each step is 0.6 m wide. */
export const KUND = rect(12, 20, 28, 36);
/** The water and everything below the second step. */
export const KUND_WATER = rect(13.2, 18.8, 29.2, 34.8);

/** The small open-fronted Ganesha shrine just inside the gate; the murti faces +x. */
export const GANESHA: Spot = { x: -5, z: 42.4, yaw: Math.PI / 2 };
export const GANESHA_SHRINE = rect(-6.3, -4.3, 41.3, 43.5);
/** The space in front of the Ganesha shrine, open to the path. */
export const GANESHA_FRONT = rect(-4.3, -0.5, 41, 43.8);

/** The torana. Visitors arrive on the approach outside it and walk in. */
export const GATE: Point = { x: 0, z: 46 };
export const GATE_PILLARS: readonly Point[] = [
  { x: 2, z: 46 },
  { x: -2, z: 46 },
];
/** Radius of the circle round each gate pillar that visitors keep clear of (the stone base). */
export const GATE_PILLAR_RADIUS = 0.45;

/** The painted "today" board beside the path, facing it. */
export const TODAY_BOARD: Spot = { x: 3, z: 44.4, yaw: -Math.PI / 2 };

/** Just inside the gate, between its pillars and the start of the path. */
export const GATE_INSIDE = rect(-2.6, 2.6, 42.4, 46.3);
/** The paved approach outside the gate, as far as visitors may walk back out. */
export const GATE_APPROACH = rect(-1.8, 1.8, 46, 55);

/**
 * New visitors appear on the approach, facing the gate and the temple beyond it, far enough out
 * that the whole torana is in the first view.
 */
export const SPAWN: Spot = { x: 0, z: 53.5, yaw: Math.PI };

/** Centre line of the path from the gate to the courtyard: straight, on the temple's axis. */
export const GATE_PATH: readonly Point[] = [
  { x: 0, z: 45.2 },
  { x: 0, z: 30 },
];
export const GATE_PATH_HALF_WIDTH = 1.8;

// ---------------------------------------------------------------------------
// Pradakshina (spec 02 § Pradakshina path)
// ---------------------------------------------------------------------------

/** The stone loop around the shrine and mandapa: sides at x = ±10.5, ends at z = −8 and z = 24. */
export const PRADAKSHINA = { x: 10.5, zWest: -8, zEast: 24, halfWidth: 1.2 } as const;

/** Server-side counting checkpoints (spec 03). `N` is just before the somasutra, coming from `W`. */
export const CHECKPOINTS = {
  E: { x: 0, z: 24 },
  S: { x: -10.5, z: 8 },
  W: { x: 0, z: -8 },
  N: { x: 10.5, z: -4 },
} as const satisfies Record<string, Point>;
export type CheckpointId = keyof typeof CHECKPOINTS;

/** The temple compound inside the forest edge, about 3 m beyond the pradakshina path. */
export const COMPOUND = rect(-14.7, 14.7, -12.2, 30);

/**
 * The jaladhari: a spout on the north wall at (2.6, 0) and a stone channel running north across
 * the pradakshina path to the forest edge.
 */
export const SOMASUTRA = { z: 0, x0: 2.6, x1: COMPOUND.x1, halfWidth: 0.35 } as const;

/** In `full` mode a slab covers the channel where it crosses the path. */
export const SOMASUTRA_BRIDGE = rect(
  PRADAKSHINA.x - PRADAKSHINA.halfWidth,
  PRADAKSHINA.x + PRADAKSHINA.halfWidth,
  -0.6,
  0.6,
);

// ---------------------------------------------------------------------------
// Ritual spots
// ---------------------------------------------------------------------------

/** Where each bell hangs. Visitors ring from within BELL_REACH_M (spec 03). */
export const BELLS: Readonly<Record<BellId, Point>> = {
  gate: { x: 0, z: 46 },
  "path-1": { x: -1.2, z: 44.4 },
  "path-2": { x: 1.2, z: 42.4 },
  "path-3": { x: -1.2, z: 40.4 },
  "path-4": { x: 1.2, z: 38.4 },
  "path-5": { x: -1.2, z: 36.4 },
  "path-6": { x: 1.2, z: 34.4 },
  "path-7": { x: -1.2, z: 32.4 },
  "path-8": { x: 1.2, z: 30.4 },
  "mandapa-n": { x: 2.2, z: 19.5 },
  "mandapa-s": { x: -2.2, z: 19.5 },
};

/** Mat grid in each block: 4 columns either side of the aisle, 5 rows, front row first. */
export const MAT_COLUMNS_X: readonly number[] = [2.4, 3.4, 4.4, 5.4];
export const MAT_ROWS_Z: readonly number[] = [8.2, 9.6, 11, 12.4, 13.8];

/**
 * MAT_COUNT mats. 0–19 are the north block (+x) and 20–39 the south block, each row by row from
 * the front, inner column first. A seated visitor faces the linga.
 */
export const MATS: readonly Spot[] = [1, -1].flatMap((side) =>
  MAT_ROWS_Z.flatMap((z) =>
    MAT_COLUMNS_X.map((cx) => {
      const p = { x: side * cx, z };
      return { ...p, yaw: yawTowards(p, LINGA) };
    }),
  ),
);

/** DIYA_SPOTS standing spots around the deepa stand, facing it. */
export const DIYA_SPOT_POSITIONS: readonly Spot[] = [
  { x: 1.6, z: 0 },
  { x: 0, z: 1.6 },
  { x: -1.6, z: 0 },
  { x: 0, z: -1.6 },
].map((d) => {
  const p = { x: DEEPA_STAND.x + d.x, z: DEEPA_STAND.z + d.z };
  return { ...p, yaw: yawTowards(p, DEEPA_STAND) };
});

/** The single jal-offering spot at the threshold, beside the door and off the axis. */
export const JAL_SPOT: Spot = { x: 1.9, z: 3.4, yaw: yawTowards({ x: 1.9, z: 3.4 }, LINGA) };

// ---------------------------------------------------------------------------
// Walkable area, obstacles and sacred zones (spec 02 § Sacred and blocked zones)
// ---------------------------------------------------------------------------

/** Where feet may go: the union of these shapes, minus obstacles and sacred zones. */
export const WALKABLE: readonly Shape[] = [
  COMPOUND,
  rect(11, 21, 27, 37), // around the kund (the rim and its first two steps)
  ...GATE_PATH.slice(1).map((b, i) => capsule(GATE_PATH[i] ?? b, b, GATE_PATH_HALF_WIDTH)),
  GANESHA_FRONT,
  GATE_INSIDE,
  GATE_APPROACH,
];

export type ObstacleId =
  | "plinth-edge"
  | "pillar"
  | "nandi"
  | "deepa-stand"
  | "aarti-plate"
  | "ganesha-shrine"
  | "today-board"
  | "gate";

export interface Obstacle {
  readonly id: ObstacleId;
  readonly shape: Shape;
}

/** Built things in the way. The plinth edge leaves the mandapa steps (east side) as the only way up. */
export const OBSTACLES: readonly Obstacle[] = [
  { id: "plinth-edge", shape: rect(7, 7.4, 4.6, 19) },
  { id: "plinth-edge", shape: rect(-7.4, -7, 4.6, 19) },
  { id: "plinth-edge", shape: rect(2.6, 7.4, 4.6, 5) },
  { id: "plinth-edge", shape: rect(-7.4, -2.6, 4.6, 5) },
  { id: "plinth-edge", shape: rect(2.6, 3, 2.6, 5) },
  { id: "plinth-edge", shape: rect(-3, -2.6, 2.6, 5) },
  ...MANDAPA_PILLARS.map((p): Obstacle => ({
    id: "pillar",
    shape: rect(
      p.x - PILLAR_HALF_SIZE,
      p.x + PILLAR_HALF_SIZE,
      p.z - PILLAR_HALF_SIZE,
      p.z + PILLAR_HALF_SIZE,
    ),
  })),
  { id: "nandi", shape: NANDI_PLATFORM },
  { id: "deepa-stand", shape: circle(DEEPA_STAND.x, DEEPA_STAND.z, DEEPA_STAND_RADIUS) },
  { id: "aarti-plate", shape: circle(AARTI_PLATE.x, AARTI_PLATE.z, 0.3) },
  { id: "ganesha-shrine", shape: GANESHA_SHRINE },
  { id: "today-board", shape: rect(2.8, 3.2, TODAY_BOARD.z - 0.8, TODAY_BOARD.z + 0.8) },
  ...GATE_PILLARS.map((p): Obstacle => ({
    id: "gate",
    shape: circle(p.x, p.z, GATE_PILLAR_RADIUS),
  })),
];

export type ZoneId = "garbhagriha" | "nandi-axis" | "kund-water" | "somasutra";

export interface Zone {
  readonly id: ZoneId;
  readonly shapes: readonly Shape[];
}

const somasutraHalf = rect(
  SOMASUTRA.x0,
  SOMASUTRA.x1,
  SOMASUTRA.z - SOMASUTRA.halfWidth,
  SOMASUTRA.z + SOMASUTRA.halfWidth,
);
const somasutraFull = [
  rect(SOMASUTRA.x0, SOMASUTRA_BRIDGE.x0, somasutraHalf.z0, somasutraHalf.z1),
  rect(SOMASUTRA_BRIDGE.x1, SOMASUTRA.x1, somasutraHalf.z0, somasutraHalf.z1),
];
const commonZones: readonly Zone[] = [
  { id: "garbhagriha", shapes: [GARBHAGRIHA] },
  { id: "nandi-axis", shapes: [NANDI_AXIS] },
  { id: "kund-water", shapes: [KUND_WATER] },
];
const ZONES: Readonly<Record<PradakshinaMode, readonly Zone[]>> = {
  // The channel is a blocking line from the shrine wall to the forest edge.
  "half-somasutra": [...commonZones, { id: "somasutra", shapes: [somasutraHalf] }],
  // The channel still can't be stepped in, but the bridge slab crosses it on the path.
  full: [...commonZones, { id: "somasutra", shapes: somasutraFull }],
};

/** The sacred and blocked zones for a pradakshina mode. */
export function sacredZones(mode: PradakshinaMode = PRADAKSHINA_MODE): readonly Zone[] {
  return ZONES[mode];
}

export type Blocker = ZoneId | ObstacleId | "outside";

/** Why a visitor can't stand at (x, z), or null if they can. Sacred zones are reported first. */
export function blockedAt(
  x: number,
  z: number,
  mode: PradakshinaMode = PRADAKSHINA_MODE,
): Blocker | null {
  // Plain loops: the client calls this many times per frame, so no closures are allocated.
  for (const zone of ZONES[mode]) {
    if (inAny(zone.shapes, x, z)) return zone.id;
  }
  if (!inAny(WALKABLE, x, z)) return "outside";
  for (const o of OBSTACLES) {
    if (inShape(o.shape, x, z)) return o.id;
  }
  return null;
}

function inAny(shapes: readonly Shape[], x: number, z: number): boolean {
  for (const s of shapes) if (inShape(s, x, z)) return true;
  return false;
}

/** True if a visitor's position (the centre of their feet) may be at (x, z). */
export function isWalkable(
  x: number,
  z: number,
  mode: PradakshinaMode = PRADAKSHINA_MODE,
): boolean {
  return blockedAt(x, z, mode) === null;
}

/**
 * True if (x, z) is on a sacred zone (garbhagriha, Nandi axis, kund water, somasutra). Non-finite
 * input is never "on" a zone, so use `isWalkable` or `segmentBlocked` to accept a position.
 */
export function inSacredZone(
  x: number,
  z: number,
  mode: PradakshinaMode = PRADAKSHINA_MODE,
): boolean {
  for (const zone of ZONES[mode]) if (inAny(zone.shapes, x, z)) return true;
  return false;
}

/** Clients keep this much clear of every blocked shape, so the server never corrects them. */
export const BODY_RADIUS = 0.25;

/** Distance from point p to segment a → b. */
function pointSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const sx = bx - ax;
  const sz = bz - az;
  const len2 = sx * sx + sz * sz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * sx + (pz - az) * sz) / len2));
  return Math.hypot(px - (ax + t * sx), pz - (az + t * sz));
}

/** True if the closed segments a → b and c → d cross or touch. */
function segmentsCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  const d1 = side(cx, cz, dx, dz, ax, az);
  const d2 = side(cx, cz, dx, dz, bx, bz);
  const d3 = side(ax, az, bx, bz, cx, cz);
  const d4 = side(ax, az, bx, bz, dx, dz);
  if (d1 !== d2 && d3 !== d4) return true;
  // Collinear or touching cases are covered by the endpoint distances in segmentHitsShape.
  return false;
}

/** Exact test: does the closed segment a → b touch shape s? */
function segmentHitsShape(s: Shape, a: Point, b: Point): boolean {
  if (inShape(s, a.x, a.z) || inShape(s, b.x, b.z)) return true;
  switch (s.kind) {
    case "rect": {
      // Liang–Barsky clipping of the segment against the rectangle.
      let t0 = 0;
      let t1 = 1;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      for (const [p, q] of [
        [-dx, a.x - s.x0],
        [dx, s.x1 - a.x],
        [-dz, a.z - s.z0],
        [dz, s.z1 - a.z],
      ] as const) {
        if (p === 0) {
          if (q < 0) return false;
          continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
        if (t0 > t1) return false;
      }
      return true;
    }
    case "circle":
      return pointSegment(s.x, s.z, a.x, a.z, b.x, b.z) <= s.r;
    case "capsule":
      return (
        segmentsCross(a.x, a.z, b.x, b.z, s.ax, s.az, s.bx, s.bz) ||
        Math.min(
          pointSegment(s.ax, s.az, a.x, a.z, b.x, b.z),
          pointSegment(s.bx, s.bz, a.x, a.z, b.x, b.z),
          pointSegment(a.x, a.z, s.ax, s.az, s.bx, s.bz),
          pointSegment(b.x, b.z, s.ax, s.az, s.bx, s.bz),
        ) <= s.r
      );
  }
}

/** Spacing of the samples that check a step stays inside the walkable area. */
const STEP_SAMPLE_M = 0.05;

/**
 * What blocks the straight step from `a` to `b`, or null if a visitor may take it. Sacred zones
 * and obstacles are tested exactly, so no step can hop over one; the walkable area (a union of
 * shapes) is sampled every 5 cm. The server's movement rule (spec 05).
 */
export function segmentBlocked(
  a: Point,
  b: Point,
  mode: PradakshinaMode = PRADAKSHINA_MODE,
): Blocker | null {
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return "outside";
  for (const zone of ZONES[mode]) {
    if (zone.shapes.some((s) => segmentHitsShape(s, a, b))) return zone.id;
  }
  for (const o of OBSTACLES) {
    if (segmentHitsShape(o.shape, a, b)) return o.id;
  }
  const steps = Math.max(1, Math.ceil(distance(a, b) / STEP_SAMPLE_M));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    if (!WALKABLE.some((s) => inShape(s, x, z))) return "outside";
  }
  return null;
}

/**
 * Whether a visitor is seated: pose `sit`, or `japa` on a mat, exactly on the mat they hold.
 * Shared, so every client draws someone as seated only where the server would seat them.
 */
export function isSeatedAt(poseIndex: number, mat: number, x: number, z: number): boolean {
  const m = mat >= 0 ? MATS[mat] : undefined;
  if (!m || (poseIndex !== SIT_POSE && poseIndex !== JAPA_POSE)) return false;
  return Math.hypot(x - m.x, z - m.z) <= 0.01;
}
const SIT_POSE = POSES.indexOf("sit");
const JAPA_POSE = POSES.indexOf("japa");

/** Within this distance of the Ganesha murti, a bow faces it rather than the sanctum (spec 03). */
export const GANESHA_BOW_M = 6;

/**
 * What a bow at `p` faces: the Ganesha murti when within GANESHA_BOW_M of it, else the linga
 * (spec 03 § Pranam). Shared, so every client turns a bowing avatar the same way.
 */
export function bowTarget(p: Point): Point {
  return distance(p, GANESHA) <= GANESHA_BOW_M ? GANESHA : LINGA;
}

/** The server's "in the mandapa" test for sitting (spec 03). */
export function inMandapa(x: number, z: number): boolean {
  return inShape(MANDAPA, x, z);
}
