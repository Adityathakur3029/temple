/**
 * Other visitors, as the server reports them (spec 04): profiles from `welcome` and `delta.join`,
 * states from snapshot and `delta.up`, departures from `delta.gone`. Remote avatars are drawn
 * INTERP_DELAY_MS behind server time, between the two samples around that moment.
 */
import {
  INTERP_DELAY_MS,
  POSES,
  type DeltaMessage,
  type StateTuple,
  type Visitor,
  type VisitorId,
  type WelcomeMessage,
} from "@sannidhi/protocol";

/**
 * A walker whose next sample is late is carried on along their last heading for at most this
 * long, so a 7 Hz Lite sender or a late delta doesn't make them stop and go.
 */
export const EXTRAPOLATE_MS = 150;
const WALK = POSES.indexOf("walk");

/** Samples kept per visitor: about a second of walking at 10 Hz. */
export const SAMPLES_KEPT = 12;
/**
 * After a pause longer than this, the previous position is repeated just before the new sample,
 * so a visitor who was standing still sets off smoothly instead of gliding all the way.
 */
export const RESTART_GAP_MS = 300;

export interface Sample {
  /** Server ms. */
  at: number;
  x: number;
  z: number;
  yaw: number;
  pose: number;
  mat: number;
}

export interface Remote {
  visitor: Visitor;
  samples: Sample[];
}

/** Where a remote visitor is drawn at one moment. Reused by the caller every frame. */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
  pose: number;
  mat: number;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Presence {
  /** This visitor's id, from the welcome. */
  me: VisitorId | null = null;
  readonly remotes = new Map<VisitorId, Remote>();
  /** Called when someone appears or leaves (counts, sheets). */
  onChange: (() => void) | null = null;

  /** Replaces everything with a welcome's snapshot. Returns this visitor's own state, if listed. */
  applyWelcome(w: WelcomeMessage): StateTuple | undefined {
    this.me = w.you.id;
    this.remotes.clear();
    for (const v of w.snapshot.visitors) {
      if (v.id !== this.me) this.remotes.set(v.id, { visitor: v, samples: [] });
    }
    let mine: StateTuple | undefined;
    for (const s of w.snapshot.states) {
      if (s[0] === this.me) mine = s;
      else this.push(s, w.serverTime);
    }
    this.onChange?.();
    return mine;
  }

  /** Applies a delta in the order gone → join → up, so an id is never left half-applied. */
  applyDelta(d: DeltaMessage): void {
    let changed = false;
    for (const id of d.gone ?? []) changed = this.remotes.delete(id) || changed;
    for (const v of d.join ?? []) {
      if (v.id === this.me) continue;
      const known = this.remotes.get(v.id);
      if (known) known.visitor = v;
      else {
        this.remotes.set(v.id, { visitor: v, samples: [] });
        changed = true;
      }
    }
    for (const s of d.up ?? []) if (s[0] !== this.me) this.push(s, d.at);
    if (changed) this.onChange?.();
  }

  clear(): void {
    const had = this.remotes.size > 0;
    this.remotes.clear();
    this.me = null;
    if (had) this.onChange?.();
  }

  private push(s: StateTuple, at: number): void {
    const r = this.remotes.get(s[0]);
    if (!r) return;
    const [, x, z, yaw, pose, mat] = s;
    const next: Sample = { at, x, z, yaw, pose, mat };
    const list = r.samples;
    const last = list[list.length - 1];
    if (last && at <= last.at) {
      list[list.length - 1] = next;
      return;
    }
    if (last && at - last.at > RESTART_GAP_MS) list.push({ ...last, at: at - RESTART_GAP_MS / 3 });
    list.push(next);
    if (list.length > SAMPLES_KEPT) list.splice(0, list.length - SAMPLES_KEPT);
  }

  /**
   * Where `r` is drawn at server time `serverNow` (INTERP_DELAY_MS behind it). False if there is
   * no sample yet. Positions are interpolated; pose and mat switch at the later sample.
   */
  sample(r: Remote, serverNow: number, out: Pose, delayMs: number = INTERP_DELAY_MS): boolean {
    const list = r.samples;
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) return false;
    const t = serverNow - delayMs;
    let a = t <= first.at ? first : last;
    let b = a;
    if (t > first.at && t < last.at) {
      for (let i = 1; i < list.length; i++) {
        const s = list[i];
        if (s && s.at > t) {
          a = list[i - 1] ?? s;
          b = s;
          break;
        }
      }
    }
    if (t > last.at && last.pose === WALK && list.length >= 2) {
      // Past the newest sample while walking: carry on briefly along the last step.
      const prev = list[list.length - 2] ?? last;
      const span = last.at - prev.at;
      const ahead = Math.min(EXTRAPOLATE_MS, t - last.at);
      const v = span > 0 && span < 400 ? ahead / span : 0;
      out.x = last.x + (last.x - prev.x) * v;
      out.z = last.z + (last.z - prev.z) * v;
      out.yaw = last.yaw;
      out.pose = last.pose;
      out.mat = last.mat;
      return true;
    }
    const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
    out.x = a.x + (b.x - a.x) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = wrap(a.yaw + wrap(b.yaw - a.yaw) * k);
    out.pose = a.pose;
    out.mat = a.mat;
    return true;
  }

  /** Mats held by others (from the `mat` field of their latest state). */
  heldMats(): Set<number> {
    const held = new Set<number>();
    for (const r of this.remotes.values()) {
      const last = r.samples[r.samples.length - 1];
      if (last && last.mat >= 0) held.add(last.mat);
    }
    return held;
  }
}
