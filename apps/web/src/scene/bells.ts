/**
 * Bells swing when rung (spec 03 § Ring a bell, spec 07 § Accessibility: bells swing as the
 * visual equivalent of their sound). The swing dies away over about two seconds.
 */
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import { BELL_IDS, type BellId } from "@sannidhi/protocol";

const SWING_S = 2.2;
const SWING_RAD = 0.32;
const SWING_HZ = 1.1;

export interface BellHang {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export class BellSwings {
  private readonly swinging = new Map<BellId, number>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly axis = new Vector3(1, 0, 0);

  constructor(
    private readonly mesh: InstancedMesh,
    private readonly hangs: Readonly<Record<BellId, BellHang>>,
  ) {}

  ring(bell: BellId): void {
    this.swinging.set(bell, 0);
  }

  get active(): boolean {
    return this.swinging.size > 0;
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.swinging.size === 0) return;
    for (const [bell, t0] of this.swinging) {
      const t = t0 + dt;
      const done = t >= SWING_S;
      // Reduced motion: a small, short swing, so the ring is still visible.
      const amp = (reducedMotion ? 0.3 : 1) * SWING_RAD * (1 - t / SWING_S) ** 2;
      const angle = done ? 0 : amp * Math.sin(t * SWING_HZ * Math.PI * 2);
      this.write(bell, angle);
      if (done) this.swinging.delete(bell);
      else this.swinging.set(bell, t);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private write(bell: BellId, angle: number): void {
    const h = this.hangs[bell];
    const i = BELL_IDS.indexOf(bell);
    // The bell's origin is its top, where it hangs, so it swings about that point.
    this.q.setFromAxisAngle(this.axis, angle);
    this.m.compose(this.p.set(h.x, h.y, h.z), this.q, this.s.setScalar(h.scale));
    this.mesh.setMatrixAt(i, this.m);
  }
}
