/**
 * Washing at the taps (spec 03 § Wash hands): a thin stream runs from a tap while someone washes
 * there, the visual equivalent of the sound of running water (spec 07 § Accessibility).
 */
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import {
  GATE,
  TAP_IDS,
  TAP_REACH_M,
  TAPS,
  WASH_TROUGH,
  distance,
  type Point,
  type TapId,
} from "@sannidhi/protocol";
import { WASH_S } from "./avatar";
import { TROUGH } from "./greybox";

/** The stream starts a moment after the hands reach the spout and stops before they shake. */
const START_S = 0.4;
const END_S = WASH_S - 0.7;
const GROW_S = 0.25;
const LENGTH = TROUGH.spoutY - TROUGH.water;

/**
 * "Wash hands" is offered within this distance of the trough, outside the gate (spec 03); it
 * then walks to a tap's spot. Washing itself needs the visitor within TAP_REACH_M of the spout.
 */
export const WASH_OFFER_M = 2.2;

/** The nearest tap within the client's reach, or null. */
export function tapInReach(p: Point): TapId | null {
  let best: TapId | null = null;
  let bestD = TAP_REACH_M;
  for (const id of TAP_IDS) {
    const d = distance(p, TAPS[id]);
    if (d <= bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

/** Close enough to the washing trough, outside the gate, to offer "Wash hands". */
export function nearTrough(p: Point): boolean {
  const t = WASH_TROUGH;
  const dx = Math.max(t.x0 - p.x, 0, p.x - t.x1);
  const dz = Math.max(t.z0 - p.z, 0, p.z - t.z1);
  return p.z > GATE.z && Math.hypot(dx, dz) <= WASH_OFFER_M;
}

/** The tap nearest to a point along the trough. */
export function nearestTap(p: Point): TapId {
  let best: TapId = TAP_IDS[0];
  for (const id of TAP_IDS) {
    if (Math.abs(TAPS[id].z - p.z) < Math.abs(TAPS[best].z - p.z)) best = id;
  }
  return best;
}

export class TapWater {
  private readonly running = new Map<TapId, number>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(private readonly mesh: InstancedMesh) {}

  run(tap: TapId): void {
    this.running.set(tap, 0);
  }

  update(dt: number): void {
    if (this.running.size === 0) return;
    for (const [tap, t0] of this.running) {
      const t = t0 + dt;
      const on = Math.min(
        Math.max(0, (t - START_S) / GROW_S),
        Math.max(0, (END_S - t) / GROW_S),
        1,
      );
      this.write(tap, on);
      if (t >= END_S) this.running.delete(tap);
      else this.running.set(tap, t);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private write(tap: TapId, on: number): void {
    const i = TAP_IDS.indexOf(tap);
    // The stream's origin is its top, at the spout; it grows down towards the water.
    this.p.set(TROUGH.spoutX, TROUGH.spoutY, TAPS[tap].z);
    this.s.set(on, LENGTH * on, on);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }
}
