/**
 * Lite detection (spec 07 § Lite mode) and the 10-second frame-rate check that can lower the
 * device tier (spec 10 § Device tiers).
 */
import { TARGET_FPS, type Tier, lowerTier } from "./tier";

/** The first 10 s averaging under this suggests Lite mode. */
export const LITE_FPS = 24;
/** How long each frame-rate measurement runs. */
export const SAMPLE_WINDOW_MS = 10000;
/** A tier counts as "under target" below this fraction of its target frame rate. */
export const TARGET_TOLERANCE = 0.9;

export interface LiteSignals {
  saveData?: boolean | undefined;
  effectiveType?: string | undefined;
  deviceMemory?: number | undefined;
}

/** True if the device or network alone is reason to suggest Lite mode at start. */
export function suggestLiteAtStart(s: LiteSignals): boolean {
  return (
    s.saveData === true ||
    s.effectiveType === "2g" ||
    s.effectiveType === "slow-2g" ||
    s.effectiveType === "3g" ||
    (s.deviceMemory !== undefined && s.deviceMemory <= 2)
  );
}

interface NavigatorWithConnection {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
}

export function readLiteSignals(
  nav: NavigatorWithConnection = navigator as NavigatorWithConnection,
): LiteSignals {
  return {
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    deviceMemory: nav.deviceMemory,
  };
}

/**
 * Collects frame times while the scene renders. `add` returns the average fps each time a window
 * of SAMPLE_WINDOW_MS fills, then starts a new window. Gaps over 1 s (a paused loop) are skipped.
 */
export class FrameSampler {
  private total = 0;
  private frames = 0;

  constructor(private readonly windowMs = SAMPLE_WINDOW_MS) {}

  add(frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > 1000) return null;
    this.total += frameMs;
    this.frames++;
    if (this.total < this.windowMs) return null;
    const fps = (this.frames * 1000) / this.total;
    this.reset();
    return fps;
  }

  reset(): void {
    this.total = 0;
    this.frames = 0;
  }
}

export interface AdaptDecision {
  /** Lower the tier to this, or null to keep it. */
  tier: Tier | null;
  suggestLite: boolean;
}

/**
 * After a window: on automatic quality, drop one tier when under target. Suggest Lite once when
 * the average is under LITE_FPS, or when the Low tier is still under target.
 */
export function decide(opts: {
  tier: Tier;
  auto: boolean;
  fps: number;
  lite: boolean;
  liteSuggested: boolean;
}): AdaptDecision {
  const under = opts.fps < TARGET_FPS[opts.tier] * TARGET_TOLERANCE;
  const tier = opts.auto && under ? lowerTier(opts.tier) : null;
  const struggling = opts.fps < LITE_FPS || (opts.tier === "low" && under);
  return { tier, suggestLite: struggling && !opts.lite && !opts.liteSuggested };
}
