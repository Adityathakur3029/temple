/**
 * View restore (spec 10 § Background, tabs and idle): sessionStorage `sannidhi:view-v1` keeps the
 * camera, the visitor's place (position, facing, mat) and, from M2/M3, hall, instance and mala bead,
 * so a reload within VIEW_CHECKPOINT_MS returns to the same view.
 */
import {
  HALL_IDS,
  INSTANCES_PER_HALL,
  MATS,
  VIEW_CHECKPOINT_MS,
  type HallId,
  isWalkable,
} from "@sannidhi/protocol";
import { type KeyValueStore, isRecord, parseJson } from "./storage";

export const VIEW_KEY = "sannidhi:view-v1";

export type CameraMode = "orbit" | "darshan";

export interface ViewCheckpoint {
  /** ms since epoch when this was written. */
  at: number;
  camera: { mode: CameraMode; yaw: number; pitch: number; distance: number };
  /** The visitor's position and facing. `mat` is −1 when not seated. */
  me: { x: number; z: number; yaw: number; mat: number };
  hall?: HallId;
  instance?: number;
  /** Current mala bead, 1–108 (M3). */
  bead?: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function saveView(store: KeyValueStore, view: ViewCheckpoint): void {
  store.setItem(VIEW_KEY, JSON.stringify(view));
}

/** The stored view if it is recent, well formed and stands somewhere a visitor may stand. */
export function loadView(store: KeyValueStore, now: number): ViewCheckpoint | null {
  const v = parseJson(store.getItem(VIEW_KEY));
  if (!isRecord(v) || !finite(v.at)) return null;
  const age = now - v.at;
  if (age < 0 || age > VIEW_CHECKPOINT_MS) return null;

  const cam = v.camera;
  const me = v.me;
  if (!isRecord(cam) || !isRecord(me)) return null;
  if (cam.mode !== "orbit" && cam.mode !== "darshan") return null;
  if (![cam.yaw, cam.pitch, cam.distance, me.x, me.z, me.yaw, me.mat].every(finite)) return null;

  const mat = me.mat as number;
  const seated = Number.isInteger(mat) && mat >= 0 && mat < MATS.length;
  if (!seated && mat !== -1) return null;
  if (!isWalkable(me.x as number, me.z as number)) return null;

  const out: ViewCheckpoint = {
    at: v.at,
    camera: {
      mode: cam.mode,
      yaw: cam.yaw as number,
      pitch: cam.pitch as number,
      distance: cam.distance as number,
    },
    me: { x: me.x as number, z: me.z as number, yaw: me.yaw as number, mat },
  };
  if (typeof v.hall === "string" && (HALL_IDS as readonly string[]).includes(v.hall)) {
    out.hall = v.hall as HallId;
  }
  if (
    Number.isInteger(v.instance) &&
    (v.instance as number) >= 1 &&
    (v.instance as number) <= INSTANCES_PER_HALL
  ) {
    out.instance = v.instance as number;
  }
  if (Number.isInteger(v.bead) && (v.bead as number) >= 1 && (v.bead as number) <= 108) {
    out.bead = v.bead as number;
  }
  return out;
}
