/**
 * Idle and calm modes (spec 10 § Background, tabs and idle). After IDLE_SLEEP_MS without input:
 * - while seated, in the mala view or during aarti ("quiet"): calm mode, rendering at 15 fps with
 *   the camera still and presence kept;
 * - otherwise: rest, with rendering stopped (and, from M2, the socket closed) until the visitor
 *   taps to return.
 */
import { IDLE_SLEEP_MS } from "@sannidhi/protocol";

export type Activity = "active" | "calm" | "rest";

/** Calm mode frame rate. */
export const CALM_FPS = 15;

export function activityFor(idleMs: number, quiet: boolean, timeoutMs = IDLE_SLEEP_MS): Activity {
  if (idleMs < timeoutMs) return "active";
  return quiet ? "calm" : "rest";
}

export class IdleMonitor {
  private lastInput: number;
  private state: Activity = "active";
  /** IDLE_SLEEP_MS unless a test shortens it. */
  timeoutMs: number;

  constructor(
    private readonly opts: {
      now: () => number;
      onChange: (activity: Activity) => void;
      timeoutMs?: number;
    },
  ) {
    this.lastInput = opts.now();
    this.timeoutMs = opts.timeoutMs ?? IDLE_SLEEP_MS;
  }

  get activity(): Activity {
    return this.state;
  }

  /** Any visitor input. */
  poke(): void {
    this.lastInput = this.opts.now();
    this.set("active");
  }

  /** Call about once a second. `quiet` is true while seated, in the mala view or during aarti. */
  tick(quiet: boolean): void {
    // Rest is left only by input, even if the visitor becomes "quiet" meanwhile.
    if (this.state === "rest") return;
    this.set(activityFor(this.opts.now() - this.lastInput, quiet, this.timeoutMs));
  }

  private set(next: Activity): void {
    if (next === this.state) return;
    this.state = next;
    this.opts.onChange(next);
  }
}
