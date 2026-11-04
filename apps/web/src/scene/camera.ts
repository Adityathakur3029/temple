/**
 * Cameras (spec 02 § Camera): a third-person orbit behind the visitor, and the darshan view that
 * frames the linga through the sanctum door from inside the mandapa. The camera pulls in front of
 * anything solid, and never enters the garbhagriha.
 */
import { LINGA, MANDAPA, SANCTUM_DOOR, type Point } from "@sannidhi/protocol";
import type { CameraMode } from "../platform/view";
import { type Box, CAMERA_BLOCKERS, PLINTH, groundY } from "./ground";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

export const ORBIT_LIMITS = {
  minDistance: 2.5,
  maxDistance: 12,
  minPitch: -10 * DEG,
  maxPitch: 35 * DEG,
} as const;

export const ORBIT_DEFAULTS = { pitch: 12 * DEG, distance: 5.5 } as const;

/** In the darshan view the visitor can look around this far (spec 02). */
export const DARSHAN_LOOK = { yaw: 25 * DEG, pitch: 12 * DEG } as const;

/** Eased follow time constant for the orbit target. */
const FOLLOW_S = 0.15;
/** Camera fly between views (cut instead with reduced motion). */
const FLY_S = 1.1;
/** The orbit camera looks a little above the head, so more of the temple ahead shows. */
const LOOK_ABOVE = 0.3;
/** Field of view: wide for the orbit, narrowed in the darshan view to frame the door. */
export const ORBIT_FOV = 55;
export function darshanFov(eye: Vec3): number {
  const d = Math.hypot(eye.x - LINGA_FOCUS.x, eye.z - LINGA_FOCUS.z);
  return Math.min(40, Math.max(18, (2 * Math.atan(2 / d) * 180) / Math.PI));
}
/** Keep the camera this far in front of what blocks it, and above the floor. */
const PAD = 0.25;
const CLEAR_FLOOR = 0.3;

export interface Orbit {
  /** The camera's horizontal look direction (same convention as avatar yaw). */
  yaw: number;
  /** Positive looks down from above. */
  pitch: number;
  distance: number;
}

/** Clamps an orbit's pitch and distance to the spec limits, writing into `out` (default: a new one). */
export function clampOrbit(o: Orbit, out: Orbit = { yaw: 0, pitch: 0, distance: 0 }): Orbit {
  out.yaw = Math.atan2(Math.sin(o.yaw), Math.cos(o.yaw));
  out.pitch = Math.min(ORBIT_LIMITS.maxPitch, Math.max(ORBIT_LIMITS.minPitch, o.pitch));
  out.distance = Math.min(ORBIT_LIMITS.maxDistance, Math.max(ORBIT_LIMITS.minDistance, o.distance));
  return out;
}

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** Where the orbit camera wants to be, before collision. */
export function orbitEye(target: Vec3, o: Orbit, out: Vec3 = vec()): Vec3 {
  const h = Math.cos(o.pitch) * o.distance;
  out.x = target.x - Math.sin(o.yaw) * h;
  out.y = target.y + Math.sin(o.pitch) * o.distance;
  out.z = target.z - Math.cos(o.yaw) * h;
  return out;
}

/** The slab test on one axis: narrows [t0, t1] in SLAB, or returns false if the ray misses. */
const SLAB = { t0: 0, t1: 0 };
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let a = (lo - o) / d;
  let c = (hi - o) / d;
  if (a > c) {
    const swap = a;
    a = c;
    c = swap;
  }
  SLAB.t0 = Math.max(SLAB.t0, a);
  SLAB.t1 = Math.min(SLAB.t1, c);
  return SLAB.t0 <= SLAB.t1;
}

/** Entry distance of a ray into a box, 0 if it starts inside, or null if it misses within maxT. */
export function rayBox(o: Vec3, d: Vec3, maxT: number, b: Box): number | null {
  SLAB.t0 = 0;
  SLAB.t1 = maxT;
  if (!slab(o.x, d.x, b.x0, b.x1) || !slab(o.y, d.y, b.y0, b.y1) || !slab(o.z, d.z, b.z0, b.z1)) {
    return null;
  }
  return SLAB.t0;
}

export function insideBox(p: Vec3, b: Box): boolean {
  return p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && p.z > b.z0 && p.z < b.z1;
}

/**
 * Moves the camera from `desired` towards `target` until nothing solid is between them and the
 * camera is above the floor and outside every box.
 */
const DIR = vec();

/** `target` + DIR × s, lifted above the floor, into `out`. */
function along(target: Vec3, s: number, out: Vec3): Vec3 {
  out.x = target.x + DIR.x * s;
  out.y = target.y + DIR.y * s;
  out.z = target.z + DIR.z * s;
  out.y = Math.max(out.y, groundY(out.x, out.z) + CLEAR_FLOOR);
  return out;
}

function insideAny(p: Vec3, boxes: readonly Box[]): boolean {
  for (const b of boxes) if (insideBox(p, b)) return true;
  return false;
}

export function pullIn(
  target: Vec3,
  desired: Vec3,
  boxes: readonly Box[] = CAMERA_BLOCKERS,
  out: Vec3 = vec(),
): Vec3 {
  const gy = Math.max(desired.y, groundY(desired.x, desired.z) + CLEAR_FLOOR);
  const dx = desired.x - target.x;
  const dy = gy - target.y;
  const dz = desired.z - target.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) {
    out.x = desired.x;
    out.y = gy;
    out.z = desired.z;
    return out;
  }
  DIR.x = dx / len;
  DIR.y = dy / len;
  DIR.z = dz / len;
  let t = len;
  for (const b of boxes) {
    const hit = rayBox(target, DIR, len, b);
    if (hit !== null) t = Math.min(t, Math.max(0, hit - PAD));
  }
  // Lifting the camera above a raised floor can put it inside something; step in until clear.
  along(target, t, out);
  while (t > 0 && insideAny(out, boxes)) {
    t = Math.max(0, t - 0.2);
    along(target, t, out);
  }
  return out;
}

/** Where the linga is framed: the top of the linga on its pitha. */
export const LINGA_FOCUS: Vec3 = { x: LINGA.x, y: PLINTH + 0.65, z: LINGA.z };

/** Widest angle off the axis from which the linga shows through the door (with a margin). */
export const DARSHAN_MAX_ANGLE = Math.atan((SANCTUM_DOOR.halfWidth - 0.4) / SANCTUM_DOOR.z);
/** The darshan camera stays inside the mandapa, clear of its end pillars. */
export const DARSHAN_DISTANCE = { min: MANDAPA.z0 + 1.5, max: MANDAPA.z1 - 0.8 } as const;

/**
 * The darshan camera for a visitor at `p`: on their side of the axis, at their distance from the
 * linga where possible, and never wider than the door allows.
 */
export function darshanEye(p: Point, seated: boolean): { eye: Vec3; look: Vec3 } {
  return { eye: darshanEyeInto(p, seated, vec()), look: LINGA_FOCUS };
}

/** The darshan eye alone, written into `out` (the frame loop's allocation-free form). */
function darshanEyeInto(p: Point, seated: boolean, out: Vec3): Vec3 {
  const angle = Math.atan2(p.x, p.z);
  const a = Math.max(-DARSHAN_MAX_ANGLE, Math.min(DARSHAN_MAX_ANGLE, angle));
  const d = Math.max(DARSHAN_DISTANCE.min, Math.min(DARSHAN_DISTANCE.max, Math.hypot(p.x, p.z)));
  out.x = Math.sin(a) * d;
  out.y = PLINTH + (seated ? 0.95 : 1.45);
  out.z = Math.cos(a) * d;
  return out;
}

/** Rotates the look direction from eye to `look` by yaw and pitch offsets, into `out`. */
function offsetLook(eye: Vec3, look: Vec3, yaw: number, pitch: number, out: Vec3): Vec3 {
  const dx = look.x - eye.x;
  const dy = look.y - eye.y;
  const dz = look.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  const baseYaw = Math.atan2(dx, dz);
  const basePitch = Math.asin(dy / dist);
  const y = baseYaw + yaw;
  const p = basePitch + pitch;
  out.x = eye.x + Math.sin(y) * Math.cos(p) * dist;
  out.y = eye.y + Math.sin(p) * dist;
  out.z = eye.z + Math.cos(y) * Math.cos(p) * dist;
  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function lerp3(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}
function copy3(from: Vec3, to: Vec3): Vec3 {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  return to;
}
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * True if the straight line between two points passes through anything solid: the garbhagriha,
 * Nandi, a pillar, the roof. A camera fly that would do so cuts instead (spec 02 § Camera).
 */
function crossesSolid(a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return insideAny(a, CAMERA_BLOCKERS);
  DIR.x = dx / len;
  DIR.y = dy / len;
  DIR.z = dz / len;
  for (const box of CAMERA_BLOCKERS) if (rayBox(a, DIR, len, box) !== null) return true;
  return false;
}

export interface CameraPose {
  eye: Vec3;
  look: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
}

export class CameraRig {
  mode: CameraMode = "orbit";
  orbit: Orbit;
  /** Darshan look-around offsets (seated only). */
  readonly darshanLook = { yaw: 0, pitch: 0 };
  // Reused every frame (spec 10 § Frame loop hygiene); callers read the returned pose at once.
  private readonly target = vec();
  private hasTarget = false;
  private readonly goal: CameraPose = { eye: vec(), look: vec(), fov: ORBIT_FOV };
  private readonly pose: CameraPose = { eye: vec(), look: vec(), fov: ORBIT_FOV };
  private hasPose = false;
  private readonly flyFrom: CameraPose = { eye: vec(), look: vec(), fov: ORBIT_FOV };
  private flyT: number | null = null;

  constructor(orbit: Partial<Orbit> & { yaw: number }) {
    this.orbit = clampOrbit({ ...ORBIT_DEFAULTS, ...orbit });
  }

  /** Switch view. With `cut` (reduced motion) the camera jumps instead of flying. */
  setMode(mode: CameraMode, cut: boolean): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.darshanLook.yaw = 0;
    this.darshanLook.pitch = 0;
    if (cut || !this.hasPose) {
      this.flyT = null;
      return;
    }
    copy3(this.pose.eye, this.flyFrom.eye);
    copy3(this.pose.look, this.flyFrom.look);
    this.flyFrom.fov = this.pose.fov;
    this.flyT = 0;
  }

  /**
   * Drag to look. Standing in the darshan view, any look returns to the orbit camera; seated, it
   * looks around a little. Returns true if the view changed mode.
   */
  lookBy(dyaw: number, dpitch: number, seated: boolean, cut: boolean): boolean {
    if (this.mode === "darshan") {
      if (seated) {
        this.darshanLook.yaw = Math.max(
          -DARSHAN_LOOK.yaw,
          Math.min(DARSHAN_LOOK.yaw, this.darshanLook.yaw + dyaw),
        );
        this.darshanLook.pitch = Math.max(
          -DARSHAN_LOOK.pitch,
          Math.min(DARSHAN_LOOK.pitch, this.darshanLook.pitch + dpitch),
        );
        return false;
      }
      this.setMode("orbit", cut);
      return true;
    }
    this.orbit = clampOrbit({
      ...this.orbit,
      yaw: this.orbit.yaw + dyaw,
      pitch: this.orbit.pitch + dpitch,
    });
    return false;
  }

  zoomBy(factor: number, seated: boolean, cut: boolean): boolean {
    if (this.mode === "darshan") {
      if (seated) return false;
      this.setMode("orbit", cut);
      return true;
    }
    this.orbit = clampOrbit({ ...this.orbit, distance: this.orbit.distance * factor });
    return false;
  }

  /** Ease the orbit round behind the visitor (used while tap-to-walk turns corners). */
  follow(yaw: number, dt: number, rate = 0.8): void {
    const diff = Math.atan2(Math.sin(yaw - this.orbit.yaw), Math.cos(yaw - this.orbit.yaw));
    const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    const yaw2 = this.orbit.yaw + step;
    this.orbit.yaw = Math.atan2(Math.sin(yaw2), Math.cos(yaw2));
  }

  /** Recenters the eased target (after a teleport such as view restore). */
  snap(): void {
    this.hasTarget = false;
    this.hasPose = false;
    this.flyT = null;
  }

  /** The camera pose for this frame. The same object is returned, and overwritten, every call. */
  update(dt: number, head: Vec3, me: Point, seated: boolean): CameraPose {
    if (this.hasTarget) lerp3(this.target, head, 1 - Math.exp(-dt / FOLLOW_S), this.target);
    else copy3(head, this.target);
    this.hasTarget = true;

    const goal = this.goal;
    if (this.mode === "darshan") {
      darshanEyeInto(me, seated, goal.eye);
      offsetLook(goal.eye, LINGA_FOCUS, this.darshanLook.yaw, this.darshanLook.pitch, goal.look);
      goal.fov = darshanFov(goal.eye);
    } else {
      // goal.look holds the unblocked eye for a moment, before it becomes the look point.
      pullIn(this.target, orbitEye(this.target, this.orbit, goal.look), CAMERA_BLOCKERS, goal.eye);
      copy3(this.target, goal.look).y += LOOK_ABOVE;
      goal.fov = ORBIT_FOV;
    }

    if (this.flyT !== null) {
      this.flyT += dt / FLY_S;
      if (this.flyT >= 1 || crossesSolid(this.flyFrom.eye, goal.eye)) this.flyT = null;
    }
    const pose = this.pose;
    if (this.flyT === null) {
      copy3(goal.eye, pose.eye);
      copy3(goal.look, pose.look);
      pose.fov = goal.fov;
    } else {
      const t = ease(this.flyT);
      lerp3(this.flyFrom.eye, goal.eye, t, pose.eye);
      lerp3(this.flyFrom.look, goal.look, t, pose.look);
      pose.fov = lerp(this.flyFrom.fov, goal.fov, t);
    }
    this.hasPose = true;
    return pose;
  }
}
