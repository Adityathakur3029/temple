/**
 * IST helpers shared by client and server. India Standard Time is UTC+05:30 all year
 * (no daylight saving), so a fixed offset is exact. Every function takes milliseconds since
 * the epoch and never reads the device's time zone.
 * Aarti scheduling arrives with M4 (specs 03, 06).
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MINUTES = 24 * 60;
const DAY_MS = DAY_MINUTES * 60000;

/** The IST calendar date, "YYYY-MM-DD", for a moment given in ms since epoch. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since 00:00 IST, with a fractional part, in [0, 1440). */
export function istMinutes(ms: number): number {
  const m = ((ms + IST_OFFSET_MS) / 60000) % DAY_MINUTES;
  return m < 0 ? m + DAY_MINUTES : m;
}

/** "HH:MM" → minutes after midnight. */
function hhmm(s: string): number {
  const [h = "0", m = "0"] = s.split(":");
  return Number(h) * 60 + Number(m);
}

// ---------------------------------------------------------------------------
// Day phases (spec 02 § Light and time)
// ---------------------------------------------------------------------------

export const DAY_PHASES = ["night", "dawn", "day", "dusk"] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

/** When each phase starts, IST, in the order they come through the day. */
export const DAY_PHASE_STARTS_IST: ReadonlyArray<readonly [DayPhase, string]> = [
  ["dawn", "05:30"],
  ["day", "06:30"],
  ["dusk", "17:30"],
  ["night", "18:30"],
];

/** Each change of phase blends from the old look to the new one over this long. */
export const PHASE_BLEND_MS = 600000;

const starts = DAY_PHASE_STARTS_IST.map(([phase, at]) => ({ phase, at: hhmm(at) }));

/** The phase whose start is the latest one at or before `minutes`, and the one before it. */
function phaseAt(minutes: number): { phase: DayPhase; previous: DayPhase; since: number } {
  let i = starts.length - 1; // before dawn, it is still the night that began yesterday
  for (let k = 0; k < starts.length; k++) {
    if ((starts[k]?.at ?? 0) <= minutes) i = k;
  }
  const current = starts[i] ?? { phase: "night" as DayPhase, at: 0 };
  const before = starts[(i + starts.length - 1) % starts.length] ?? current;
  const since = (minutes - current.at + DAY_MINUTES) % DAY_MINUTES;
  return { phase: current.phase, previous: before.phase, since };
}

/** The time-of-day phase for a moment, by the IST table. */
export function dayPhase(ms: number): DayPhase {
  return phaseAt(istMinutes(ms)).phase;
}

export interface PhaseBlend {
  from: DayPhase;
  to: DayPhase;
  /** 0 shows `from`, 1 shows `to`. Outside a transition `from` and `to` are the same and t is 1. */
  t: number;
}

/** How far the scene is through the current phase change. Blends start at each phase's start. */
export function phaseBlend(ms: number): PhaseBlend {
  const { phase, previous, since } = phaseAt(istMinutes(ms));
  const blendMinutes = PHASE_BLEND_MS / 60000;
  if (since >= blendMinutes) return { from: phase, to: phase, t: 1 };
  return { from: previous, to: phase, t: since / blendMinutes };
}

/** "HH:MM" IST today (by IST date) as ms since epoch, for previews such as `?ist=19:05`. */
export function istTimeOnDay(ms: number, time: string): number {
  // Integer day maths, so the result is a whole number of ms.
  const midnight = Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return midnight + hhmm(time) * 60000;
}
