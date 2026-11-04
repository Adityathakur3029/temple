/**
 * The visitor's own movement (spec 02 § Controls): calm walking at WALK_SPEED_MPS, no running.
 * Two inputs: a path from tap-to-walk, or a direction from the keyboard. Every step is checked
 * against world.ts, so no input sequence can put the visitor on a sacred or blocked zone.
 */
import { WALK_SPEED_MPS, isWalkable, type Point, type Spot } from "@sannidhi/protocol";
import { BODY_RADIUS, isClear } from "./nav";

/** Largest simulation step; longer frames are split so collision stays exact. */
const MAX_STEP_S = 1 / 30;
/** How fast the body turns towards where it walks. */
const TURN_RATE = 7;

export interface MoveInput {
  /** World-space direction. Length 0 means no keyboard input. */
  x: number;
  z: number;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A body-radius check with the default mode, so keyboardStep needs no closure. */
const isClearForBody = (x: number, z: number): boolean => isClear(x, z, BODY_RADIUS);

export class Walker {
  x: number;
  z: number;
  yaw: number;
  /** Metres per second actually moved during the last update (for the walk animation). */
  speed = 0;
  /** Total distance walked, which drives the stride phase. */
  travelled = 0;
  private path: Point[] = [];
  private onArrive: (() => void) | null = null;
  private faceYaw: number | null = null;
  /** While true, a tap-to-walk path waits (for example until the avatar has stood up). */
  hold = false;

  constructor(spot: Spot) {
    this.x = spot.x;
    this.z = spot.z;
    this.yaw = spot.yaw;
  }

  get walkingPath(): boolean {
    return this.path.length > 0;
  }

  /** Follow waypoints (from NavGrid.findPath). `onArrive` runs only if the walk completes. */
  follow(points: readonly Point[], onArrive: (() => void) | null = null): void {
    this.path = points.slice();
    this.onArrive = onArrive;
    this.faceYaw = null;
    if (this.path.length === 0) this.arrive();
  }

  stop(): void {
    this.path = [];
    this.onArrive = null;
  }

  /** Turn in place to face a direction (for example a mat's yaw when sitting). */
  face(yaw: number): void {
    this.faceYaw = yaw;
  }

  place(spot: Spot): void {
    this.stop();
    this.x = spot.x;
    this.z = spot.z;
    this.yaw = spot.yaw;
    this.faceYaw = null;
  }

  update(dt: number, input: MoveInput | null): void {
    const startX = this.x;
    const startZ = this.z;
    let left = Math.max(0, dt);
    while (left > 1e-6) {
      const h = Math.min(left, MAX_STEP_S);
      left -= h;
      this.step(h, input);
    }
    const moved = Math.hypot(this.x - startX, this.z - startZ);
    this.travelled += moved;
    this.speed = dt > 0 ? moved / dt : 0;
  }

  private step(h: number, input: MoveInput | null): void {
    const len = input ? Math.hypot(input.x, input.z) : 0;
    let heading: number | null = null;

    if (input && len > 1e-3) {
      // Keyboard input takes over from any tap-to-walk path.
      this.stop();
      this.faceYaw = null;
      const k = (Math.min(1, len) * WALK_SPEED_MPS * h) / len;
      this.keyboardStep(input.x * k, input.z * k);
      heading = Math.atan2(input.x, input.z);
    } else if (this.path.length > 0 && !this.hold) {
      const target = this.path[0] ?? { x: this.x, z: this.z };
      const dx = target.x - this.x;
      const dz = target.z - this.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = WALK_SPEED_MPS * h;
      const nx = dist <= stepLen ? target.x : this.x + (dx / dist) * stepLen;
      const nz = dist <= stepLen ? target.z : this.z + (dz / dist) * stepLen;
      // Paths come from the clearance grid; the centre check is what the server applies too.
      if (!isWalkable(nx, nz)) {
        this.stop();
        return;
      }
      this.x = nx;
      this.z = nz;
      if (dist > 1e-4) heading = Math.atan2(dx, dz);
      if (dist <= stepLen) {
        this.path.shift();
        if (this.path.length === 0) this.arrive();
      }
    } else if (this.faceYaw !== null) {
      heading = this.faceYaw;
    }

    if (heading !== null) {
      const diff = wrapAngle(heading - this.yaw);
      const turn = Math.min(1, TURN_RATE * h);
      this.yaw = wrapAngle(this.yaw + diff * turn);
      if (this.faceYaw !== null && Math.abs(diff) < 1e-3) {
        this.yaw = this.faceYaw;
        this.faceYaw = null;
      }
    }
  }

  /** Move with the body radius kept clear, sliding along walls. */
  private keyboardStep(dx: number, dz: number): void {
    // If a path left the body closer than its radius to an edge, allow any move that stays legal.
    const tight = !isClear(this.x, this.z, BODY_RADIUS);
    const ok = tight ? isWalkable : isClearForBody;
    if (ok(this.x + dx, this.z + dz)) {
      this.x += dx;
      this.z += dz;
    } else if (ok(this.x + dx, this.z)) {
      this.x += dx;
    } else if (ok(this.x, this.z + dz)) {
      this.z += dz;
    }
  }

  private arrive(): void {
    const done = this.onArrive;
    this.onArrive = null;
    done?.();
  }
}
