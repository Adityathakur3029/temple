/**
 * Other visitors' avatars (spec 02 § Avatar, spec 10 § Techniques the budgets assume).
 * Each is drawn where Presence interpolates it, INTERP_DELAY_MS behind server time.
 * Near avatars (≤ 8 m, at most 8) use the finer geometry and animate every frame; the rest use
 * the coarse geometry and animate at 10 Hz. Until M5 every avatar is one skinned draw call;
 * M5 moves far avatars to instanced vertex animation textures.
 */
import {
  CircleGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Vector3,
  type Camera,
  type Material,
} from "three";
import {
  INSTANCE_CAPACITY,
  POSES,
  bowTarget,
  isSeatedAt,
  yawTowards,
  type VisitorId,
} from "@sannidhi/protocol";
import type { Pose, Presence } from "../net/presence";
import { Avatar, GESTURE_S, type GestureAnim } from "./avatar";

export const NEAR_M = 8;
/** A near avatar goes back to the coarse geometry only beyond this, so it doesn't flicker at 8 m. */
export const FAR_M = 9;
export const NEAR_MAX = 8;
/** Far avatars animate at this rate. */
const FAR_STEP_S = 0.1;
/** Level of detail is chosen again this often. */
const LOD_EVERY_S = 0.5;
/** A tap within this many CSS px of someone's chest picks them. */
export const PICK_PX = 40;

const PRANAM = POSES.indexOf("pranam");

interface Member {
  id: VisitorId;
  avatar: Avatar;
  x: number;
  z: number;
  travelled: number;
  pending: number;
  near: boolean;
  seen: boolean;
  /** Distance from the viewer at the last level-of-detail pass. */
  dist: number;
  /** A gesture from an `event`, waiting until the interpolated avatar has caught up. */
  queued: { kind: GestureAnim; at: number } | null;
  /** Until when (ms) the avatar bows, facing the shrine whatever the stream says. */
  bowUntil: number;
}

export class Crowd {
  readonly group = new Group();
  private readonly members = new Map<VisitorId, Member>();
  private readonly order: Member[] = [];
  private readonly at: Pose = { x: 0, z: 0, yaw: 0, pose: 0, mat: -1 };
  private readonly blobs: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly v = new Vector3();
  private lodClock = LOD_EVERY_S;

  constructor(
    private readonly presence: Presence,
    blobMaterial: Material,
    private readonly floorY: (x: number, z: number, sitBlend: number) => number,
  ) {
    // Soft round shadows under everyone, in one draw call (blob shadows, spec 10).
    this.blobs = new InstancedMesh(new CircleGeometry(0.42, 16), blobMaterial, INSTANCE_CAPACITY);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.group.add(this.blobs);
  }

  get size(): number {
    return this.members.size;
  }

  /** Blob shadows are hidden on the High tier, which has real shadows. */
  set blobShadows(on: boolean) {
    this.blobs.visible = on;
  }

  /** Adds and removes avatars to match Presence. */
  sync(): void {
    for (const [id, m] of this.members) {
      if (!this.presence.remotes.has(id)) {
        m.avatar.dispose();
        this.members.delete(id);
      }
    }
    for (const [id, r] of this.presence.remotes) {
      if (this.members.has(id)) continue;
      const avatar = new Avatar({ shawl: r.visitor.shawl, body: r.visitor.body, detail: "low" });
      avatar.root.visible = false;
      this.group.add(avatar.root);
      this.members.set(id, {
        id,
        avatar,
        x: 0,
        z: 0,
        travelled: 0,
        pending: 0,
        near: false,
        seen: false,
        dist: Number.POSITIVE_INFINITY,
        queued: null,
        bowUntil: 0,
      });
    }
    this.order.length = 0;
    for (const m of this.members.values()) this.order.push(m);
    this.lodClock = LOD_EVERY_S;
  }

  /**
   * Someone's gesture or bell, from an `event`. It starts once the avatar, drawn `delayMs`
   * behind, has caught up with the moment it was sent, so a bow never starts mid-turn.
   */
  play(id: VisitorId, kind: GestureAnim, now: number, delayMs: number): void {
    const m = this.members.get(id);
    if (m) m.queued = { kind, at: now + delayMs };
  }

  /**
   * @param now performance.now(), for gestures
   * @param delayMs how far behind server time remote avatars are drawn
   */
  update(dt: number, serverNow: number, viewer: Vector3, now: number, delayMs: number): void {
    this.lodClock += dt;
    if (this.lodClock >= LOD_EVERY_S) {
      this.lodClock = 0;
      this.chooseDetail(viewer);
    }
    let blob = 0;
    for (const m of this.order) {
      const r = this.presence.remotes.get(m.id);
      if (!r || !this.presence.sample(r, serverNow, this.at, delayMs)) {
        m.avatar.root.visible = false;
        continue;
      }
      const a = this.at;
      const moved = m.seen ? Math.hypot(a.x - m.x, a.z - m.z) : 0;
      // A jump (a correction or a resume) is not a stride.
      if (moved < 1) m.travelled += moved;
      m.x = a.x;
      m.z = a.z;
      m.seen = true;
      const avatar = m.avatar;
      // Seated only where the server would seat them: on their own mat (shared rule).
      avatar.setSeated(isSeatedAt(a.pose, a.mat, a.x, a.z));
      if (m.queued && now >= m.queued.at) {
        avatar.play(m.queued.kind);
        if (m.queued.kind === "pranam") m.bowUntil = now + GESTURE_S.pranam * 1000;
        m.queued = null;
      }
      // Someone who joined mid-bow still sees it; the bow from the event isn't played twice.
      if (a.pose === PRANAM && avatar.playing === null && now > m.bowUntil + 500) {
        avatar.play("pranam");
        m.bowUntil = now + GESTURE_S.pranam * 1000;
      }

      m.pending += dt;
      const step = m.near ? m.pending : m.pending >= FAR_STEP_S ? m.pending : 0;
      if (step > 0) {
        avatar.update(step, dt > 0 ? moved / dt : 0, m.travelled);
        m.pending = 0;
      }
      const y = this.floorY(a.x, a.z, avatar.sitBlend);
      avatar.root.position.set(a.x, y, a.z);
      // A bow always faces the sanctum, or the Ganesha murti nearby (spec 03 § Pranam).
      avatar.root.rotation.y = now < m.bowUntil ? yawTowards(a, bowTarget(a)) : a.yaw;
      avatar.root.visible = true;

      if (this.blobs.visible && blob < INSTANCE_CAPACITY) {
        this.m.makeRotationX(-Math.PI / 2);
        this.m.setPosition(a.x, this.floorY(a.x, a.z, 0) + 0.03, a.z);
        this.blobs.setMatrixAt(blob++, this.m);
      }
    }
    this.blobs.count = blob;
    if (blob > 0) this.blobs.instanceMatrix.needsUpdate = true;
  }

  /**
   * The nearest NEAR_MAX avatars within NEAR_M get the finer geometry and every-frame updates.
   * One that is already near stays near out to FAR_M.
   */
  private chooseDetail(viewer: Vector3): void {
    for (const m of this.order) m.dist = Math.hypot(m.x - viewer.x, m.z - viewer.z);
    this.order.sort((p, q) => p.dist - q.dist);
    for (let i = 0; i < this.order.length; i++) {
      const m = this.order[i];
      if (!m) continue;
      m.near = i < NEAR_MAX && m.dist <= (m.near ? FAR_M : NEAR_M);
      m.avatar.setDetail(m.near ? "high" : "low");
    }
  }

  /** Who is under a tap, by their projected chest, or null. */
  pick(clientX: number, clientY: number, camera: Camera, rect: DOMRect): VisitorId | null {
    let best: VisitorId | null = null;
    let bestD = PICK_PX;
    for (const m of this.order) {
      if (!m.avatar.root.visible) continue;
      this.v.copy(m.avatar.root.position);
      this.v.y += m.avatar.sitBlend > 0.5 ? 0.6 : 1.15;
      this.v.project(camera);
      if (this.v.z > 1) continue; // behind the camera
      const sx = rect.left + ((this.v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - this.v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = m.id;
      }
    }
    return best;
  }

  /** Above someone's head, in world space, for a name label. Reuses `out`. */
  headOf(id: VisitorId, out: Vector3): Vector3 | null {
    const m = this.members.get(id);
    if (!m?.avatar.root.visible) return null;
    out.copy(m.avatar.root.position);
    out.y += m.avatar.sitBlend > 0.5 ? 1.15 : 1.85;
    return out;
  }

  dispose(): void {
    for (const m of this.members.values()) m.avatar.dispose();
    this.members.clear();
    this.order.length = 0;
    this.blobs.geometry.dispose();
    this.blobs.dispose();
    this.group.removeFromParent();
  }
}
