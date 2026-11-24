/**
 * Sounds the temple can play (spec 06 § Channels, spec 11 § Sounds).
 *
 * - **Effects** (`bell`) are short clips with one or more variants (bell-1, bell-2 …); one is
 *   picked at random each time, with a small random change of pitch, so repeated rings don't
 *   sound mechanical. They overlap, up to a voice cap.
 * - **Beds** are loops that play one at a time under everything else (spec 06 § Background
 *   and meditation): the day and night background, and the visitor's own meditation.
 */

export const SOUND_IDS = [
  "bell",
  "pour",
  "background-day",
  "background-night",
  "meditation",
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export type SoundChannel = "ambience" | "effects" | "chant";

/** How a sound is built and played: a short effect, or a seamless loop. */
export type SoundKind = "effect" | "loop";

export interface SoundFormat {
  bitrate: string;
  sampleRate: number;
  channels: 1 | 2;
  /** The built file never peaks above this, in dBFS. */
  peakDb: number;
  /** Integrated loudness the build aims for, in LUFS; null to set the level by peak only. */
  lufs: number | null;
  /** Fade at the end of the clip, in seconds; 0 for loops, which must join without a gap. */
  fadeOutS: number;
}

/** Built effects are AAC-LC, mono, 64 kbps, 44.1 kHz, peaking at −6 dBFS (spec 06 § Loudness). */
export const EFFECT_FORMAT: Readonly<SoundFormat> = {
  bitrate: "64k",
  sampleRate: 44_100,
  channels: 1,
  peakDb: -6,
  lufs: null,
  fadeOutS: 0.15,
};

/** The background loops: stereo, 64 kbps, about −20 LUFS (spec 06 § Loudness). */
export const BACKGROUND_FORMAT: Readonly<SoundFormat> = {
  bitrate: "64k",
  sampleRate: 44_100,
  channels: 2,
  peakDb: -1,
  lufs: -20,
  fadeOutS: 0,
};

/** Meditation loops: stereo, 96 kbps, −18 LUFS, like the aarti (spec 06 § Loudness). */
export const MEDITATION_FORMAT: Readonly<SoundFormat> = {
  bitrate: "96k",
  sampleRate: 44_100,
  channels: 2,
  peakDb: -1,
  lufs: -18,
  fadeOutS: 0,
};

export interface SoundSpec {
  /** What the sound is, for people reading the config. */
  label: string;
  kind: SoundKind;
  channel: SoundChannel;
  format: Readonly<SoundFormat>;
  /** Voices of this sound that may play at once on one client; the oldest is stopped beyond it. */
  maxVoices: number;
  /** Variants the config may list (spec 03: three bell samples). */
  maxVariants: number;
  /** Longest source clip, in seconds. */
  maxSeconds: number;
  /** Random pitch change, as a fraction (0.03 = ±3 %). */
  pitchJitter: number;
  /**
   * Fetched only when the visitor asks for it (the meditation button), so it doesn't count
   * towards a visit's download budget (spec 10).
   */
  onDemand: boolean;
}

export const SOUNDS: Readonly<Record<SoundId, SoundSpec>> = {
  bell: {
    label: "A brass bell struck once, ringing out",
    kind: "effect",
    channel: "effects",
    format: EFFECT_FORMAT,
    maxVoices: 4,
    maxVariants: 3,
    maxSeconds: 8,
    pitchJitter: 0.03,
    onDemand: false,
  },
  pour: {
    label: "Water poured softly from a small copper lota",
    kind: "effect",
    channel: "effects",
    format: EFFECT_FORMAT,
    maxVoices: 2,
    maxVariants: 2,
    maxSeconds: 8,
    pitchJitter: 0.03,
    onDemand: false,
  },
  "background-day": {
    label: "The daytime background, looped",
    kind: "loop",
    channel: "ambience",
    format: BACKGROUND_FORMAT,
    maxVoices: 1,
    maxVariants: 1,
    maxSeconds: 120,
    pitchJitter: 0,
    onDemand: false,
  },
  "background-night": {
    label: "The night background, looped",
    kind: "loop",
    channel: "ambience",
    format: BACKGROUND_FORMAT,
    maxVoices: 1,
    maxVariants: 1,
    maxSeconds: 120,
    pitchJitter: 0,
    onDemand: false,
  },
  meditation: {
    label: "Meditation music for one visitor; one is picked at random and looped",
    kind: "loop",
    channel: "chant",
    format: MEDITATION_FORMAT,
    maxVoices: 1,
    maxVariants: 8,
    maxSeconds: 120,
    pitchJitter: 0,
    onDemand: true,
  },
};

export function isSoundId(v: unknown): v is SoundId {
  return typeof v === "string" && (SOUND_IDS as readonly string[]).includes(v);
}
