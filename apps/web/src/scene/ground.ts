/**
 * Heights for the greybox. The shared world (world.ts) is 2D; the client adds floor heights and
 * the 3D boxes the camera may not pass through (spec 02 § Camera).
 */
import {
  ANTARALA,
  GANESHA_SHRINE,
  GARBHAGRIHA,
  GATE,
  GATE_PILLARS,
  GATE_PILLAR_RADIUS,
  KUND,
  MANDAPA,
  MANDAPA_PILLARS,
  NANDI_PLATFORM,
  PILLAR_HALF_SIZE,
  DEEPA_STAND,
  type Rect,
} from "@sannidhi/protocol";

/** Floor height of the mandapa, antarala and sanctum. */
export const PLINTH = 0.45;
/** The mandapa steps run from the plinth edge (z 19) down to the courtyard (z 20). */
export const STEPS = { z0: 19, z1: 20, halfWidth: 7 } as const;
/** Paving sits just above the forest floor. */
export const PAVING = 0.025;
/** Kund steps: each 0.6 m wide and 0.25 m lower than the last. */
export const KUND_STEP = { width: 0.6, drop: 0.25 } as const;
export const KUND_WATER_Y = -0.68;
export const KUND_FLOOR_Y = -1.6;

/** Heights used by the greybox builder. */
export const HEIGHTS = {
  shrineWall: 4.5,
  doorTop: PLINTH + 2.4,
  shikharaTop: 16.1,
  pillarTop: 4.2,
  roof: { y0: 4.2, y1: 5.9 },
  antaralaRoof: { y0: 3.7, y1: 4.0 },
} as const;

const inRect = (r: Rect, x: number, z: number): boolean =>
  x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Height of the walking surface at (x, z). */
export function groundY(x: number, z: number): number {
  if (inRect(MANDAPA, x, z) || inRect(ANTARALA, x, z) || inRect(GARBHAGRIHA, x, z)) return PLINTH;
  if (z > STEPS.z0 && z < STEPS.z1 && Math.abs(x) <= STEPS.halfWidth) {
    return PLINTH * ((STEPS.z1 - z) / (STEPS.z1 - STEPS.z0));
  }
  if (inRect(KUND, x, z)) {
    const inset = Math.min(x - KUND.x0, KUND.x1 - x, z - KUND.z0, KUND.z1 - z);
    const step = Math.min(3, Math.floor(inset / KUND_STEP.width) + 1);
    return -KUND_STEP.drop * step;
  }
  return PAVING;
}

/** An axis-aligned box in world space. */
export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({
  x0,
  x1,
  y0,
  y1,
  z0,
  z1,
});

/** Solid things the camera pulls in front of. The sanctum box covers the door too. */
export const CAMERA_BLOCKERS: readonly Box[] = [
  box(
    GARBHAGRIHA.x0 - 0.3,
    GARBHAGRIHA.x1 + 0.3,
    0,
    HEIGHTS.shikharaTop,
    GARBHAGRIHA.z0 - 0.3,
    GARBHAGRIHA.z1 + 0.3,
  ),
  box(-2.9, 2.9, HEIGHTS.antaralaRoof.y0, HEIGHTS.antaralaRoof.y1, 2.6, 5.3),
  box(
    MANDAPA.x0 - 0.6,
    MANDAPA.x1 + 0.6,
    HEIGHTS.roof.y0,
    HEIGHTS.roof.y1,
    MANDAPA.z0 - 0.4,
    MANDAPA.z1 + 0.8,
  ),
  ...MANDAPA_PILLARS.map((p) => {
    const h = PILLAR_HALF_SIZE + 0.05;
    return box(p.x - h, p.x + h, 0, HEIGHTS.pillarTop + 0.2, p.z - h, p.z + h);
  }),
  box(NANDI_PLATFORM.x0, NANDI_PLATFORM.x1, 0, 1.6, NANDI_PLATFORM.z0, NANDI_PLATFORM.z1),
  box(
    GANESHA_SHRINE.x0 - 0.15,
    GANESHA_SHRINE.x1 + 0.15,
    0,
    3.3,
    GANESHA_SHRINE.z0 - 0.15,
    GANESHA_SHRINE.z1 + 0.15,
  ),
  ...GATE_PILLARS.map((p) => {
    const r = GATE_PILLAR_RADIUS;
    return box(p.x - r, p.x + r, 0, 3.8, p.z - r, p.z + r);
  }),
  box(-2.8, 2.8, 3.3, 3.8, GATE.z - 0.4, GATE.z + 0.4),
  box(DEEPA_STAND.x - 0.8, DEEPA_STAND.x + 0.8, 0, 2.3, DEEPA_STAND.z - 0.8, DEEPA_STAND.z + 0.8),
];

/** The box the camera may never be inside: the garbhagriha. */
export const SANCTUM_BOX: Box = CAMERA_BLOCKERS[0] ?? box(0, 0, 0, 0, 0, 0);
