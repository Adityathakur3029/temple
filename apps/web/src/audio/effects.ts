/**
 * Short sound effects (spec 06 § Spatial effects): decoded once into AudioBuffers when sound is
 * first turned on, then played with a random variant and a small random pitch change. Your own
 * actions play plainly; other visitors' play from where they happen, 6 dB quieter. Each sound
 * has a voice cap, and a new voice beyond it stops the oldest (spec 06: at most 4 bells).
 */
import { SOUNDS, type SoundId } from "../assets/sounds";
import type { Mixer } from "./mixer";

/** Remote actions are 6 dB quieter at equal distance (spec 06). */
export const REMOTE_GAIN = 10 ** (-6 / 20);

/** Spatial settings for remote sounds (spec 06 § Spatial effects). */
export const PANNER: Readonly<PannerOptions> = {
  panningModel: "equalpower",
  distanceModel: "inverse",
  refDistance: 2,
  maxDistance: 40,
};

interface Voice {
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
}

/**
 * Adds `voice` to `pool`, keeping at most `max`; returns the voices pushed out, oldest first.
 */
export function admitVoice<T>(pool: T[], voice: T, max: number): T[] {
  pool.push(voice);
  return pool.length > max ? pool.splice(0, pool.length - max) : [];
}

export interface PlayOptions {
  /** Where the sound happens, in metres. Leave out for your own actions. */
  at?: { x: number; y: number; z: number };
  /** Another visitor's action. */
  remote?: boolean;
}

export class Effects {
  private readonly buffers = new Map<SoundId, AudioBuffer[]>();
  private readonly voices = new Map<SoundId, Voice[]>();
  private loading: Promise<void> | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly mixer: Mixer,
    private readonly urls: Partial<Record<SoundId, string[]>>,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly random: () => number = Math.random,
  ) {
    // Nothing is downloaded until the visitor turns sound on (spec 10 § Loading order).
    this.unsubscribe = mixer.onChange(() => {
      if (mixer.audible) void this.load();
    });
    if (mixer.audible) void this.load();
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.mixer.context();
    const out = this.mixer.channel(SOUNDS[id].channel);
    const variants = this.buffers.get(id);
    if (!ctx || !out || !variants || variants.length === 0) return;
    const spec = SOUNDS[id];

    const source = ctx.createBufferSource();
    source.buffer = variants[Math.floor(this.random() * variants.length)] ?? variants[0] ?? null;
    source.playbackRate.value = 1 + (this.random() * 2 - 1) * spec.pitchJitter;
    const nodes: AudioNode[] = [source];
    let tail: AudioNode = source;
    if (opts.remote) {
      const gain = ctx.createGain();
      gain.gain.value = REMOTE_GAIN;
      tail = tail.connect(gain);
      nodes.push(gain);
    }
    if (opts.at) {
      const panner = new PannerNode(ctx, {
        ...PANNER,
        positionX: opts.at.x,
        positionY: opts.at.y,
        positionZ: opts.at.z,
      });
      tail = tail.connect(panner);
      nodes.push(panner);
    }
    tail.connect(out);

    const pool = this.voices.get(id) ?? [];
    this.voices.set(id, pool);
    const voice: Voice = { source, nodes };
    source.addEventListener("ended", () => {
      const i = pool.indexOf(voice);
      if (i >= 0) pool.splice(i, 1);
      for (const n of nodes) n.disconnect();
    });
    for (const old of admitVoice(pool, voice, spec.maxVoices)) {
      try {
        old.source.stop();
      } catch {
        // Already stopped.
      }
    }
    source.start();
  }

  dispose(): void {
    this.unsubscribe();
    for (const pool of this.voices.values()) {
      for (const v of pool) {
        try {
          v.source.stop();
        } catch {
          // Already stopped.
        }
      }
    }
    this.voices.clear();
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const ctx = this.mixer.context();
      if (!ctx) {
        this.loading = null;
        return;
      }
      await Promise.all(
        (Object.entries(this.urls) as [SoundId, string[]][])
          // Loops (background, meditation) are played by Beds, one at a time, when needed.
          .filter(([id]) => SOUNDS[id].kind === "effect")
          .map(async ([id, list]) => {
            const decoded = await Promise.all(
              list.map(async (url) => {
                try {
                  const res = await this.fetchFn(url);
                  if (!res.ok) return null;
                  return await ctx.decodeAudioData(await res.arrayBuffer());
                } catch {
                  // A missing or broken file leaves that sound silent; the bell still swings.
                  return null;
                }
              }),
            );
            const ok = decoded.filter((b): b is AudioBuffer => b !== null);
            if (ok.length > 0) this.buffers.set(id, ok);
          }),
      );
    })();
    return this.loading;
  }
}
