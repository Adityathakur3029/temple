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
import { BELL_IDS, POSES, TAP_IDS, type BellId, type TapId } from "./messages";
import { TREE_TRUNKS } from "./trees";

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

/**
 * The open pillared hall, on a raised plinth reached by steps on its east side. Its west end meets
 * the sanctum's east wall, so the sanctum door opens straight into the hall (no antarala; owner,
 * 2026-11-24).
 */
export const MANDAPA = rect(-7, 7, 2.6, 19);

/**
 * 14 pillars: five down each side (the first at the west corners, by the sanctum wall), and two
 * at each end of the aisle.
 */
export const MANDAPA_PILLARS: readonly Point[] = [
  ...[3.2, 5.6, 10, 14.4, 18.6].flatMap((z) => [
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
/** Nandi's head, at the sanctum end of his platform. */
export const NANDI_HEAD: Point = { x: 0, z: 21.3 };
/**
 * Where a visitor stands to whisper to Nandi (spec 03 § Whisper to Nandi): beside his head, one
 * each side of the platform, where the pradakshina carpet arms end, facing his head. Both ears
 * are offered by default (check with advisor, spec 08).
 */
export const NANDI_EAR_SPOTS: readonly Spot[] = [1, -1].map((side) => {
  const at = { x: side * 1.3, z: 21.5 };
  return { ...at, yaw: yawTowards(at, NANDI_HEAD) };
});
/**
 * Where a visitor stands for darshan between Nandi's horns (spec 03 § Shringa darshan): on the
 * yard just behind his platform, off the Nandi axis, facing the sanctum.
 */
export const SHRINGA_SPOT: Spot = { x: 0, z: 23.6, yaw: Math.PI };

/** The strip between Nandi and the sanctum. No standing, sitting or walking on it. */
export const NANDI_AXIS = rect(-0.4, 0.4, 0, 22);

/**
 * The two walkable darshan carpets, one each side of the Nandi axis (this is the +x one; the
 * other is its mirror), from the sanctum door to just in front of Nandi's platform. Decoration
 * on walkable floor, clear of the axis and the inner mats (spec 02).
 */
export const DARSHAN_CARPET = { x0: 0.45, x1: 1.3 } as const;

export const COURTYARD = rect(-12, 12, 19, 30);

/** The 108-lamp tiered stand. */
export const DEEPA_STAND: Point = { x: -8.5, z: 25 };
export const DEEPA_STAND_RADIUS = 0.8;

/**
 * Where visitors take aarti after the service. The stand is hidden for now (owner, 2026-11-21):
 * nothing is drawn here and it blocks no one until take-aarti brings it back.
 */
export const AARTI_PLATE: Point = { x: 2.2, z: 20.5 };

/** Stepped tank, centre (16, 32), 8 × 8 m. Each step is 0.6 m wide. */
export const KUND = rect(12, 20, 28, 36);
/** The water and everything below the second step. */
export const KUND_WATER = rect(13.2, 18.8, 29.2, 34.8);

/**
 * Plain backless stone benches on the lawn, all turned to face the temple (−z) so anyone resting
 * on them looks towards the shikhara (owner, 2026-11-24): two each side of the gate path, then
 * three on the strip of lawn north of the kund, between its rim and the compound wall, looking
 * over the water. Visitors sit on them (spec 03 § Sit on a bench); only append, since the order
 * numbers the seats.
 */
export const BENCHES: readonly Spot[] = [
  { x: 5.5, z: 32, yaw: Math.PI },
  { x: -5.5, z: 32, yaw: Math.PI },
  { x: 8, z: 37.5, yaw: Math.PI },
  { x: -8, z: 37.5, yaw: Math.PI },
  { x: 13.5, z: 38.2, yaw: Math.PI },
  { x: 16.5, z: 38.2, yaw: Math.PI },
  { x: 19.5, z: 38.2, yaw: Math.PI },
];
/** Half a bench's length (along x) and depth (along z), seat slab included. */
export const BENCH_HALF_LENGTH = 0.8;
export const BENCH_HALF_DEPTH = 0.25;
/**
 * The seat slab's top. Low, to suit the devotee figures (about 1.16 m tall), so a seated
 * figure's feet rest flat on the ground (spec 03 § Sit on a bench).
 */
export const BENCH_SEAT_TOP = 0.22;
/** A bench seat's spot is this far in front of the bench's centre line (clear of the bench). */
export const BENCH_SEAT_FRONT = 0.52;
/**
 * The seat spots: two per bench, 0.4 m either side of its centre (the −x one first), in front of
 * it, facing the temple. Seat numbers MAT_COUNT … MAT_COUNT + 7 (spec 03 § Sit on a bench). A
 * seated figure is drawn on the slab behind its spot.
 */
export const BENCH_SEATS: readonly Spot[] = BENCHES.flatMap((b) =>
  [-0.4, 0.4].map((dx) => ({
    x: b.x + dx,
    z: b.z + Math.cos(b.yaw) * BENCH_SEAT_FRONT,
    yaw: b.yaw,
  })),
);

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

/**
 * The painted "today" board just outside the gate, beside the approach, turned 30° from +z
 * towards the arrival spot so visitors read it as they come in. Its front faces (sin yaw, cos yaw).
 */
export const TODAY_BOARD: Spot = { x: 3, z: 48.6, yaw: -Math.PI / 6 };
/** Half the board's width, post to post, along its face. */
export const TODAY_BOARD_HALF_WIDTH = 0.8;

/** Just inside the gate, between its pillars and the start of the path. */
export const GATE_INSIDE = rect(-2.6, 2.6, 42.4, 46.3);
/** The paved approach outside the gate, as far as visitors may walk back out. */
export const GATE_APPROACH = rect(-1.8, 1.8, 46, 55);

/**
 * The washing trough on the west side of the approach (on the left as a visitor arrives), its
 * five brass taps on the back wall with their spouts facing the approach (+x). Spec 02 § Layout.
 */
export const WASH_TROUGH = rect(-3.6, -3.0, 47.6, 51.6);
/** The paving in front of the trough, joined to the approach. */
export const WASH_AREA = rect(-2.9, -1.8, 47.4, 51.8);
/** Where each tap's spout is, on the trough's back wall. */
export const TAPS: Readonly<Record<TapId, Point>> = {
  "tap-1": { x: -3.6, z: 47.8 },
  "tap-2": { x: -3.6, z: 48.7 },
  "tap-3": { x: -3.6, z: 49.6 },
  "tap-4": { x: -3.6, z: 50.5 },
  "tap-5": { x: -3.6, z: 51.4 },
};
/** Where a visitor stands to wash at each tap, facing it (−x). */
export const TAP_SPOTS: Readonly<Record<TapId, Spot>> = Object.fromEntries(
  TAP_IDS.map((id) => [id, { x: -2.55, z: TAPS[id].z, yaw: -Math.PI / 2 }]),
) as Record<TapId, Spot>;

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
 * the pradakshina path and the lawn to the compound wall (its inner face at x 15.8), where it
 * drains out under the wall. It reaches the wall so no one can walk round its end.
 */
export const SOMASUTRA = { z: 0, x0: 2.6, x1: 15.8, halfWidth: 0.35 } as const;

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

/**
 * The two jal-offering spots on the mandapa floor at the threshold, one each side of the door and
 * off the axis (north first, then its mirror), in the order of JAL_SIDES. A visitor offers from
 * the nearer one; each side has its own turn, so two may offer at once (spec 03 § Offer water,
 * bel patra or a flower).
 */
export const JAL_SPOTS: readonly Spot[] = [1, -1].map((side) => {
  const p = { x: side * 1.9, z: 3.4 };
  return { ...p, yaw: yawTowards(p, LINGA) };
});
/** The north jal spot (the first of JAL_SPOTS). */
export const JAL_SPOT: Spot = JAL_SPOTS[0] as Spot;
/**
 * The brass plates on the mandapa floor beside the door, one each side, off the Nandi axis,
 * where bel patra and flowers are laid. Nobody steps on them.
 */
export const OFFERING_PLATES: readonly Point[] = [
  { x: 1.6, z: 2.85 },
  { x: -1.6, z: 2.85 },
];
export const OFFERING_PLATE: Point = OFFERING_PLATES[0] as Point;
export const OFFERING_PLATE_RADIUS = 0.18;
/**
 * The small copper tirtha pot with its spoon, on a small stone stand beside the north jal spot,
 * where charanamrit is received (spec 03 § Receive charanamrit).
 */
export const TIRTHA_POT: Point = { x: 2.75, z: 3.4 };
/** The tirtha pot's stand, kept clear like the plate (the stand itself is 0.13 m in radius). */
export const TIRTHA_STAND_RADIUS = 0.15;
/**
 * Where a visitor stands to lay a bel patra or a flower, one per side: close enough to that
 * side's plate for the hands to reach it, and within reach of that side's jal spot (spec 03).
 */
export const LAY_SPOTS: readonly Point[] = [
  { x: 1.82, z: 3.25 },
  { x: -1.82, z: 3.25 },
];
export const LAY_SPOT: Point = LAY_SPOTS[0] as Point;
/** Where a visitor stands to receive charanamrit, facing the tirtha pot. */
export const CHARANAMRIT_SPOT: Spot = {
  x: 2.3,
  z: 3.75,
  yaw: yawTowards({ x: 2.3, z: 3.75 }, TIRTHA_POT),
};
/**
 * The two low stone offering benches against the sanctum's front wall, one each side of the door
 * beyond the jal spots (owner, 2026-11-24). Each holds a basket of flowers, a basket of bel patra
 * and a copper lota of water; a visitor takes from the bench on their side before offering.
 */
export const OFFERING_BENCHES: readonly Point[] = [
  { x: 3.55, z: 2.86 },
  { x: -3.55, z: 2.86 },
];
/** Half an offering bench's length (along x) and depth (along z). */
export const OFFERING_BENCH_HALF_LENGTH = 0.45;
export const OFFERING_BENCH_HALF_DEPTH = 0.2;
/** The offering bench's top. */
export const OFFERING_BENCH_TOP = 0.3;
/** Where a visitor stands to take from each bench, facing it (−z). */
export const PICK_SPOTS: readonly Spot[] = OFFERING_BENCHES.map((b) => ({
  x: b.x,
  z: b.z + OFFERING_BENCH_HALF_DEPTH + 0.4,
  yaw: Math.PI,
}));

/** The index of the jal spot (0 north, 1 south) nearer to `p`. */
export function nearestJalSide(p: Point): number {
  const [n, s] = JAL_SPOTS as [Spot, Spot];
  return distance(p, s) < distance(p, n) ? 1 : 0;
}
/** How far `p` is from the nearer jal spot, or from the given side's spot (0 north, 1 south). */
export function jalDistance(p: Point, side: number = nearestJalSide(p)): number {
  return distance(p, (JAL_SPOTS[side] ?? JAL_SPOTS[0]) as Spot);
}

// ---------------------------------------------------------------------------
// Walkable area, obstacles and sacred zones (spec 02 § Sacred and blocked zones)
// ---------------------------------------------------------------------------

/**
 * The low stone compound wall (prakara) round all four sides of the temple grounds: the front
 * wall runs out from both sides of the torana, and the wall goes round behind the lawn, about a
 * metre outside the paving, stepping out on the east to take in the kund. Its centre line, from
 * the east gate pillar round to the west one; the wall is WALL_THICK wide.
 */
export const WALL_LINE: readonly Point[] = [
  { x: 2.6, z: GATE.z + 0.2 },
  { x: 12.2, z: GATE.z + 0.2 },
  { x: 12.2, z: 38.8 },
  { x: 22.4, z: 38.8 },
  { x: 22.4, z: 25.2 },
  { x: 16, z: 25.2 },
  { x: 16, z: -13.5 },
  { x: -16, z: -13.5 },
  { x: -16, z: 38.8 },
  { x: -12.2, z: 38.8 },
  { x: -12.2, z: GATE.z + 0.2 },
  { x: -2.6, z: GATE.z + 0.2 },
];
export const WALL_THICK = 0.4;

/** The grass inside the compound wall, up to the wall's inner face (spec 02 § Layout). */
export const LAWN: readonly Rect[] = [
  rect(-15.8, 15.8, -13.3, 38.6),
  rect(15.8, 22.2, 25.4, 38.6), // the kund's corner
  rect(-12, 12, 38.6, 46), // either side of the gate path
];

/** The paved ways: the compound, round the kund, the gate path and the gate. */
export const PATHS: readonly Shape[] = [
  COMPOUND,
  rect(11, 21, 27, 37), // around the kund (the rim and its first two steps)
  ...GATE_PATH.slice(1).map((b, i) => capsule(GATE_PATH[i] ?? b, b, GATE_PATH_HALF_WIDTH)),
  GANESHA_FRONT,
  GATE_INSIDE,
  GATE_APPROACH,
  WASH_AREA,
];

/** Where feet may go: the union of these shapes, minus obstacles and sacred zones. */
export const WALKABLE: readonly Shape[] = [...PATHS, ...LAWN];

const distanceTo = (s: Shape, x: number, z: number): number => {
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
};

/** Distance from (x, z) to the nearest paved way (0 on it). */
export function pathDistance(x: number, z: number): number {
  let d = Infinity;
  for (const s of PATHS) d = Math.min(d, distanceTo(s, x, z));
  return d;
}

/** A post holding a path bell: just off the gate path, on the lawn. */
export interface BellPost extends Point {
  readonly id: BellId;
  /** The side of the path the post stands on (+1 is +x); the path is towards −side. */
  readonly side: number;
}

/**
 * The posts that hold the path bells: just off the path, with room for the lamp shelf, so the
 * lamp doesn't reach over the path. The gate path runs along x = 0.
 */
export const BELL_POSTS: readonly BellPost[] = BELL_IDS.filter((id) => id.startsWith("path")).map(
  (id) => {
    const p = BELLS[id];
    const side = Math.sign(p.x) || 1;
    let x = p.x + side * 0.6;
    // Step out until the post is more than 0.3 m clear of every paved way (tenths of a metre).
    while (pathDistance(x, p.z) <= 0.3) x = Math.round((x + side * 0.1) * 10) / 10;
    return { id, x, z: p.z, side };
  },
);
/** How far each post's lamp stands from the post's centre, towards the path. */
export const BELL_POST_LAMP_OUT = 0.18;
/**
 * The blocked shape round a post and its lamp: wide enough that no visitor's body (checked at
 * its centre and eight rim points) reaches into the lamp.
 */
export const BELL_POST_RADIUS = 0.17;

export type ObstacleId =
  | "plinth-edge"
  | "pillar"
  | "nandi"
  | "deepa-stand"
  | "ganesha-shrine"
  | "today-board"
  | "gate"
  | "bell-post"
  | "tree"
  | "bench"
  | "offering-plate"
  | "offering-bench"
  | "tirtha-stand";

export interface Obstacle {
  readonly id: ObstacleId;
  readonly shape: Shape;
}

/** Built things in the way. The plinth edge leaves the mandapa steps (east side) as the only way up. */
export const OBSTACLES: readonly Obstacle[] = [
  { id: "plinth-edge", shape: rect(7, 7.4, 2.2, 19) },
  { id: "plinth-edge", shape: rect(-7.4, -7, 2.2, 19) },
  { id: "plinth-edge", shape: rect(2.6, 7.4, 2.2, 2.6) },
  { id: "plinth-edge", shape: rect(-7.4, -2.6, 2.2, 2.6) },
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
  { id: "ganesha-shrine", shape: GANESHA_SHRINE },
  {
    id: "today-board",
    // A capsule along the board's face; its width runs along (cos yaw, −sin yaw).
    shape: capsule(
      {
        x: TODAY_BOARD.x - Math.cos(TODAY_BOARD.yaw) * TODAY_BOARD_HALF_WIDTH,
        z: TODAY_BOARD.z + Math.sin(TODAY_BOARD.yaw) * TODAY_BOARD_HALF_WIDTH,
      },
      {
        x: TODAY_BOARD.x + Math.cos(TODAY_BOARD.yaw) * TODAY_BOARD_HALF_WIDTH,
        z: TODAY_BOARD.z - Math.sin(TODAY_BOARD.yaw) * TODAY_BOARD_HALF_WIDTH,
      },
      0.2,
    ),
  },
  ...GATE_PILLARS.map((p): Obstacle => ({
    id: "gate",
    shape: circle(p.x, p.z, GATE_PILLAR_RADIUS),
  })),
  ...BELL_POSTS.map((p): Obstacle => ({
    id: "bell-post",
    shape: capsule(p, { x: p.x - p.side * BELL_POST_LAMP_OUT, z: p.z }, BELL_POST_RADIUS),
  })),
  // The trunks of the trees that stand on the lawn (the client grows the same trees).
  ...TREE_TRUNKS.map((t): Obstacle => ({ id: "tree", shape: circle(t.x, t.z, t.r) })),
  ...OFFERING_PLATES.map((p): Obstacle => ({
    id: "offering-plate",
    shape: circle(p.x, p.z, OFFERING_PLATE_RADIUS),
  })),
  ...OFFERING_BENCHES.map((b): Obstacle => ({
    id: "offering-bench",
    shape: rect(
      b.x - OFFERING_BENCH_HALF_LENGTH,
      b.x + OFFERING_BENCH_HALF_LENGTH,
      b.z - OFFERING_BENCH_HALF_DEPTH,
      b.z + OFFERING_BENCH_HALF_DEPTH,
    ),
  })),
  { id: "tirtha-stand", shape: circle(TIRTHA_POT.x, TIRTHA_POT.z, TIRTHA_STAND_RADIUS) },
  ...BENCHES.map((b): Obstacle => ({
    id: "bench",
    shape: rect(
      b.x - BENCH_HALF_LENGTH,
      b.x + BENCH_HALF_LENGTH,
      b.z - BENCH_HALF_DEPTH,
      b.z + BENCH_HALF_DEPTH,
    ),
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
 * Whether a visitor is seated: pose `sit`, or `japa` while seated, exactly on the seat (mat or
 * bench seat spot) they hold. Shared, so every client draws someone as seated only where the
 * server would seat them.
 */
export function isSeatedAt(poseIndex: number, mat: number, x: number, z: number): boolean {
  const m = mat >= 0 ? SEATS[mat] : undefined;
  if (!m || (poseIndex !== SIT_POSE && poseIndex !== JAPA_POSE)) return false;
  return Math.hypot(x - m.x, z - m.z) <= 0.01;
}
const SIT_POSE = POSES.indexOf("sit");

/** Every seat by its number: the mats, then the bench seats (spec 03). */
export const SEATS: readonly Spot[] = [...MATS, ...BENCH_SEATS];

/** What kind of seat a seat number is, or null if it is none. */
export function seatKind(seat: number): "mat" | "bench" | null {
  if (!Number.isInteger(seat) || seat < 0) return null;
  if (seat < MATS.length) return "mat";
  return seat < SEATS.length ? "bench" : null;
}
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
