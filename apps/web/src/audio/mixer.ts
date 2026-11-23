/**
 * The sound mixer (spec 06 § Channels): one AudioContext, a gain per channel, then the master
 * gain. Sound stays off until the visitor turns it on, and browsers only start audio inside a
 * tap or key press, so the context is created or resumed there (spec 06 § Unlock). The choice
 * and the volumes are kept in localStorage `sannidhi:audio-v1` (spec 09).
 */
import type { SoundChannel } from "../assets/sounds";
import { type KeyValueStore, isRecord, parseJson } from "../platform/storage";

export const AUDIO_KEY = "sannidhi:audio-v1";

export interface AudioSettings {
  /** The master switch. */
  on: boolean;
  /** Volumes, 0–100. */
  master: number;
  ambience: number;
  effects: number;
  chant: number;
}

export const DEFAULT_AUDIO: Readonly<AudioSettings> = {
  on: false,
  master: 100,
  ambience: 60,
  effects: 70,
  chant: 80,
};

const CHANNELS: readonly SoundChannel[] = ["ambience", "effects", "chant"];

function volume(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v)
    ? Math.min(100, Math.max(0, Math.round(v)))
    : fallback;
}

export function parseAudioSettings(raw: string | null): AudioSettings {
  const v = parseJson(raw);
  if (!isRecord(v)) return { ...DEFAULT_AUDIO };
  return {
    on: typeof v.on === "boolean" ? v.on : DEFAULT_AUDIO.on,
    master: volume(v.master, DEFAULT_AUDIO.master),
    ambience: volume(v.ambience, DEFAULT_AUDIO.ambience),
    effects: volume(v.effects, DEFAULT_AUDIO.effects),
    chant: volume(v.chant, DEFAULT_AUDIO.chant),
  };
}

/** A 0–100 volume as a gain, on a curve that sounds even across the slider. */
export function gainOf(v: number): number {
  return (v / 100) ** 2;
}

type AudioContextCtor = new (opts?: AudioContextOptions) => AudioContext;

export class Mixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly gains: Partial<Record<SoundChannel, GainNode>> = {};
  private value: AudioSettings;
  private hidden = false;
  private readonly listeners = new Set<() => void>();
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly store: KeyValueStore,
    private readonly win: Window = window,
  ) {
    this.value = parseAudioSettings(store.getItem(AUDIO_KEY));
    // Sound was on last time: start it at the visitor's first tap or key press.
    const unlock = (): void => {
      if (this.value.on && !this.audible) this.start();
    };
    for (const type of ["pointerdown", "keydown"] as const) {
      win.addEventListener(type, unlock, { capture: true });
      this.off.push(() => win.removeEventListener(type, unlock, { capture: true }));
    }
  }

  get settings(): Readonly<AudioSettings> {
    return this.value;
  }

  /** Sound is on and the browser is playing it. Until then the HUD offers "Turn sound on". */
  get audible(): boolean {
    return this.value.on && this.ctx?.state === "running";
  }

  /** Turns sound on or off. Call it from a tap or key press, or the browser keeps it silent. */
  setOn(on: boolean): void {
    this.save({ on });
    if (on) this.start();
    else void this.ctx?.suspend().catch(() => undefined);
    this.notify();
  }

  toggle(): void {
    this.setOn(!this.audible);
  }

  /** A hidden tab plays no ambience or effects (spec 06 § Background). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => undefined);
    else if (this.value.on) void this.ctx.resume().catch(() => undefined);
  }

  /** The context, only while sound is playing. */
  context(): AudioContext | null {
    return this.audible ? this.ctx : null;
  }

  channel(c: SoundChannel): GainNode | null {
    return this.gains[c] ?? null;
  }

  /** Where the visitor hears from: the camera, looking along (fx, fy, fz) with +y up. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      // Older Safari and Firefox only have the deprecated setters.
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.listeners.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private start(): void {
    if (!this.ctx) {
      const w = this.win as Window & {
        AudioContext?: AudioContextCtor;
        webkitAudioContext?: AudioContextCtor;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      for (const c of CHANNELS) {
        const g = ctx.createGain();
        g.connect(this.master);
        this.gains[c] = g;
      }
      ctx.addEventListener("statechange", () => this.notify());
      this.ctx = ctx;
      this.applyVolumes();
    }
    if (!this.hidden) void this.ctx.resume().catch(() => undefined);
  }

  private applyVolumes(): void {
    if (!this.master) return;
    this.master.gain.value = gainOf(this.value.master);
    for (const c of CHANNELS) {
      const g = this.gains[c];
      if (g) g.gain.value = gainOf(this.value[c]);
    }
  }

  private save(patch: Partial<AudioSettings>): void {
    this.value = { ...this.value, ...patch };
    this.store.setItem(AUDIO_KEY, JSON.stringify(this.value));
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
