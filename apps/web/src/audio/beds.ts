/**
 * The bed: the one loop that plays under everything else, for this visitor only (spec 06 §
 * Background and meditation). Which loop it is follows a fixed order:
 *
 * 1. **Meditation**, while this visitor has it on: one meditation picked at random, looped.
 * 2. **Aarti**, while an aarti is on, for everyone (played by the aarti player, not here).
 * 3. **Background**: `background-day` by day, `background-night` at night (IST).
 *
 * So meditation during the aarti pauses the aarti for that visitor only, and stopping it goes
 * back to whatever is due now. Changes cross-fade. Bells are effects and overlap on top.
 * Nothing plays while sound is off; the mixer's master switch silences everything.
 */
import { dayPhase } from "@sannidhi/protocol";
import { SOUNDS, type SoundId } from "../assets/sounds";
import type { Mixer } from "./mixer";

export type BedId = "meditation" | "aarti" | "background-day" | "background-night";

export interface BedInputs {
  /** This visitor turned meditation on. */
  meditating: boolean;
  /** An aarti is playing for everyone. */
  aarti: boolean;
  /** It is night by the IST table (spec 02 § Light and time). */
  night: boolean;
}

/** Which bed plays: meditation, then aarti, then the background for the time of day. */
export function chooseBed(s: BedInputs): BedId {
  if (s.meditating) return "meditation";
  if (s.aarti) return "aarti";
  return s.night ? "background-night" : "background-day";
}

/** Night for the background: the night phase of the IST table (18:30–05:30). */
export function isNight(ms: number): boolean {
  return dayPhase(ms) === "night";
}

/** A random meditation, never the same one twice in a row when there's a choice. */
export function pickVariant(count: number, last: number, random: () => number): number {
  if (count <= 1) return 0;
  const i = Math.floor(random() * (count - 1));
  return last >= 0 && i >= last ? i + 1 : i;
}

/** Cross-fade between beds, in seconds. */
export const BED_FADE_S = 1.5;

/** How often the bed checks the clock for day turning to night. */
const CHECK_MS = 15_000;

interface Playing {
  key: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export interface BedOptions {
  /** Server-synced time in ms. */
  now: () => number;
  /** Whether an aarti is playing for everyone now; until the aarti player exists, never. */
  aarti?: () => boolean;
  fetchFn?: typeof fetch;
  random?: () => number;
}

export class Beds {
  private meditating = false;
  private variant = -1;
  private playing: Playing | null = null;
  /** The bed asked for last; a load that finishes after another change is dropped. */
  private wantKey: string | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private readonly listeners = new Set<() => void>();
  private readonly fetchFn: typeof fetch;
  private readonly random: () => number;

  constructor(
    private readonly mixer: Mixer,
    private readonly urls: Partial<Record<SoundId, string[]>>,
    private readonly opts: BedOptions,
  ) {
    this.fetchFn = opts.fetchFn ?? ((...a) => fetch(...a));
    this.random = opts.random ?? Math.random;
    this.unsubscribe = mixer.onChange(() => this.update());
    this.timer = setInterval(() => this.update(), CHECK_MS);
    this.update();
  }

  get isMeditating(): boolean {
    return this.meditating;
  }

  /** Meditation can be offered only if there's at least one meditation file. */
  get canMeditate(): boolean {
    return (this.urls.meditation?.length ?? 0) > 0;
  }

  setMeditating(on: boolean): void {
    if (on === this.meditating) return;
    this.meditating = on;
    if (on) {
      this.variant = pickVariant(this.urls.meditation?.length ?? 0, this.variant, this.random);
    }
    this.update();
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call when an aarti starts or ends, so the bed follows at once. */
  refresh(): void {
    this.update();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
    this.listeners.clear();
    this.stop(0);
    this.buffers.clear();
  }

  /** The loop due now, or null when nothing should play here (sound off, aarti, no file). */
  private target(): { key: string; id: SoundId; url: string } | null {
    const bed = chooseBed({
      meditating: this.meditating,
      aarti: this.opts.aarti?.() ?? false,
      night: isNight(this.opts.now()),
    });
    if (bed === "aarti") return null;
    const list = this.urls[bed] ?? [];
    const i = bed === "meditation" ? Math.max(0, this.variant) % Math.max(1, list.length) : 0;
    const url = list[i];
    return url === undefined ? null : { key: `${bed}#${i}`, id: bed, url };
  }

  private update(): void {
    const ctx = this.mixer.context();
    if (!ctx) {
      // Sound off or the tab hidden: stop at once; the right bed starts again when it's back.
      this.stop(0);
      this.wantKey = null;
      return;
    }
    const t = this.target();
    const key = t?.key ?? null;
    if (key === this.wantKey) return;
    this.wantKey = key;
    this.stop(BED_FADE_S);
    this.evict(t?.url);
    if (!t) return;
    void this.buffer(ctx, t.url).then((buffer) => {
      // Another change came while this loaded, or sound went off.
      if (!buffer || this.wantKey !== t.key || this.mixer.context() !== ctx) return;
      const out = this.mixer.channel(SOUNDS[t.id].channel);
      if (!out) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + BED_FADE_S);
      source.connect(gain).connect(out);
      source.start();
      this.playing = { key: t.key, source, gain };
    });
  }

  /** Fades the current bed out over `fadeS` seconds (0: at once) and lets it go. */
  private stop(fadeS: number): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    const ctx = p.gain.context;
    const now = ctx.currentTime;
    try {
      if (fadeS > 0) {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setValueAtTime(p.gain.gain.value, now);
        p.gain.gain.linearRampToValueAtTime(0, now + fadeS);
      }
      p.source.stop(now + fadeS);
    } catch {
      // Already stopped.
    }
    p.source.addEventListener("ended", () => {
      p.source.disconnect();
      p.gain.disconnect();
    });
  }

  /**
   * Keeps the decoded backgrounds (small, used all visit) and the bed in use; drops other
   * meditations, as each decoded loop takes several MB (spec 10 § Memory).
   */
  private evict(keep: string | undefined): void {
    const backgrounds = new Set([
      ...(this.urls["background-day"] ?? []),
      ...(this.urls["background-night"] ?? []),
    ]);
    for (const url of this.buffers.keys()) {
      if (url !== keep && !backgrounds.has(url)) this.buffers.delete(url);
    }
  }

  private buffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = (async () => {
        try {
          const res = await this.fetchFn(url);
          if (!res.ok) return null;
          return await ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          // A missing or broken file leaves the bed silent; nothing else depends on it.
          return null;
        }
      })();
      this.buffers.set(url, p);
      // A failed load may be tried again next time.
      void p.then((b) => {
        if (!b && this.buffers.get(url) === p) this.buffers.delete(url);
      });
    }
    return p;
  }
}
