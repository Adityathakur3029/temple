/**
 * The movement rule for `pos` (spec 05 § Movement rule): speed, the whole step against the
 * walkable area and every sacred and blocked zone, and pose transitions. Pure, so tests can drive
 * position streams without a socket.
 */
import {
  MATS,
  MOVE_MAX_DT_MS,
  POSES,
  SEAT_REACH_M,
  SPEED_LIMIT_MPS,
  isSeatedAt,
  distance,
  isWalkable,
  roundCm,
  roundYaw,
  segmentBlocked,
  type Blocker,
  type PosMessage,
} from "@sannidhi/protocol";

/** Extra distance allowed on top of SPEED_LIMIT_MPS × dt, for jitter. */
export const MOVE_SLACK_M = 0.5;

export const POSE = {
  stand: POSES.indexOf("stand"),
  walk: POSES.indexOf("walk"),
  sit: POSES.indexOf("sit"),
  pranam: POSES.indexOf("pranam"),
  japa: POSES.indexOf("japa"),
  offer: POSES.indexOf("offer"),
} as const;

/** Where a visitor is, as the server last accepted it. */
export interface Place {
  x: number;
  z: number;
  yaw: number;
  /** Index into POSES. */
  pose: number;
  /** The mat the visitor holds, or −1. */
  mat: number;
  /** Server ms of the last accepted position. */
  posAt: number;
  /**
   * True until the first `pos` after a welcome (fresh or resumed). That one may be anywhere
   * walkable, so a reload with view restore (spec 10) keeps the visitor's place (spec 05 § Open
   * decisions 3). It still can't be on a sacred zone.
   */
  firstPos: boolean;
}

export type MoveVerdict =
  { ok: true; place: Place } | { ok: false; why: Blocker | "too-far" | "pose" | "seated" };

/** True if the place is seated on its mat (sitting, or doing japa while seated). */
export function isSeated(p: Pick<Place, "x" | "z" | "pose" | "mat">): boolean {
  return isSeatedAt(p.pose, p.mat, p.x, p.z);
}

export function checkMove(cur: Place, msg: PosMessage, now: number): MoveVerdict {
  const pose = POSES.indexOf(msg.pose);
  const next = { x: roundCm(msg.x), z: roundCm(msg.z) };
  const mat = cur.mat >= 0 ? MATS[cur.mat] : undefined;
  const nearMat = mat !== undefined && distance(next, mat) <= SEAT_REACH_M;

  // Pose transitions. `offer` belongs to a diya or jal turn, which arrive in M3.
  if (pose === POSE.offer) return { ok: false, why: "pose" };
  if (pose === POSE.sit && !nearMat) return { ok: false, why: "pose" };
  const seatedNow = isSeated(cur);
  const staysSeated = (pose === POSE.sit || pose === POSE.japa) && nearMat;
  // A seated visitor stays on the mat until they stand up (any other pose stands them up).
  if (seatedNow && (pose === POSE.sit || pose === POSE.japa) && !nearMat) {
    return { ok: false, why: "seated" };
  }

  if (cur.firstPos) {
    if (!isWalkable(next.x, next.z)) return { ok: false, why: "outside" };
  } else {
    // Capped, so a visitor who stood still a while can't jump far in one step (spec 05).
    const dt = Math.min(MOVE_MAX_DT_MS, Math.max(0, now - cur.posAt)) / 1000;
    if (distance(cur, next) > SPEED_LIMIT_MPS * dt + MOVE_SLACK_M)
      return { ok: false, why: "too-far" };
    const blocked = segmentBlocked(cur, next);
    if (blocked) return { ok: false, why: blocked };
  }

  if (staysSeated && mat) {
    // Seated visitors sit exactly on the mat, facing the sanctum (spec 03 § Sit on a mat).
    return {
      ok: true,
      place: {
        x: mat.x,
        z: mat.z,
        yaw: roundYaw(mat.yaw),
        pose,
        mat: cur.mat,
        posAt: now,
        firstPos: false,
      },
    };
  }
  return {
    ok: true,
    place: {
      ...next,
      yaw: roundYaw(msg.yaw),
      pose,
      // Getting up from the mat frees it, as `stand` would.
      mat: seatedNow ? -1 : cur.mat,
      posAt: now,
      firstPos: false,
    },
  };
}
