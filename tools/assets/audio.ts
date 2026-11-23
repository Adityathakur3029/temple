/**
 * Builds one sound variant (spec 06 § Loudness and formats, spec 11 § Sounds): source clip in,
 * AAC-LC `.m4a` out, in the sound's format. Effects are mono, peaking at no more than −6 dBFS,
 * with a short fade at the end so a clip cut early never clicks. Loops are stereo, levelled to
 * a loudness target (LUFS) with a peak ceiling, and never faded, so they join without a gap.
 * Uses the ffmpeg binary from `ffmpeg-static`, which is a build tool only and never shipped.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SOUNDS, type SoundFormat, type SoundId } from "../../apps/web/src/assets/sounds";

const run = promisify(execFile);

function ffmpegPath(): string {
  const path = createRequire(import.meta.url)("ffmpeg-static") as string | null;
  if (!path || !existsSync(path)) {
    throw new Error(
      "ffmpeg is missing. Run `npm approve-scripts ffmpeg-static`, then `npm install`, and try again",
    );
  }
  return path;
}

/** ffmpeg writes its reports to stderr, so a successful run's stderr is what we read. */
async function ffmpeg(args: string[]): Promise<string> {
  const { stderr } = await run(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stderr;
}

/** Duration in seconds and loudest sample in dBFS of an audio file. */
export async function probe(file: string): Promise<{ seconds: number; peakDb: number }> {
  const out = await ffmpeg(["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out);
  const p = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(out);
  if (!d || !p) throw new Error(`couldn't read ${file} as audio`);
  const seconds = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const peakDb = p[1] === "-inf" ? -Infinity : Number(p[1]);
  if (!(peakDb > -60)) throw new Error(`${file} is silent`);
  return { seconds, peakDb };
}

/** Integrated loudness of an audio file, in LUFS (EBU R128). */
export async function loudness(file: string): Promise<number> {
  const out = await ffmpeg(["-i", file, "-af", "ebur128", "-f", "null", "-"]);
  // The summary at the end repeats "I:"; the last one is the whole file's.
  const all = [...out.matchAll(/\bI:\s*(-?[\d.]+|-inf) LUFS/g)];
  const last = all.at(-1)?.[1];
  if (last === undefined || last === "-inf") throw new Error(`couldn't measure ${file}`);
  return Number(last);
}

export interface BuiltSound {
  bytes: Uint8Array;
  seconds: number;
  /** Gain applied to reach the target peak, in dB. */
  gainDb: number;
}

/** Encodes `file` as built, with `gainDb` applied, into `out` (AAC, or float WAV to measure). */
async function encode(
  f: Readonly<SoundFormat>,
  file: string,
  out: string,
  gainDb: number,
  fadeStart: number,
  codec: "aac" | "pcm" = "aac",
): Promise<void> {
  const fade = f.fadeOutS > 0 ? `,afade=t=out:st=${fadeStart.toFixed(3)}:d=${f.fadeOutS}` : "";
  const audio =
    codec === "aac"
      ? ["-c:a", "aac", "-profile:a", "aac_low", "-b:a", f.bitrate, "-movflags", "+faststart"]
      : ["-c:a", "pcm_f32le"];
  await ffmpeg([
    "-i",
    file,
    "-vn",
    "-map_metadata",
    "-1",
    "-af",
    `volume=${gainDb}dB${fade}`,
    "-ar",
    String(f.sampleRate),
    "-ac",
    String(f.channels),
    ...audio,
    // Same input, same bytes: no encoder tag or timestamps, so release hashes stay stable.
    "-fflags",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-y",
    out,
  ]);
}

/** Re-encodes at most this many times to bring an AAC overshoot back under the peak. */
const MAX_TRIES = 4;

export async function buildSound(sound: SoundId, file: string): Promise<BuiltSound> {
  const spec = SOUNDS[sound];
  const f = spec.format;
  const { seconds } = await probe(file);
  if (seconds > spec.maxSeconds) {
    throw new Error(`${seconds.toFixed(1)} s is longer than ${spec.maxSeconds} s; trim it`);
  }
  const target = f.peakDb;
  const fadeStart = Math.max(0, seconds - f.fadeOutS);
  const dir = mkdtempSync(join(tmpdir(), "sannidhi-audio-"));
  const out = join(dir, "out.m4a");
  try {
    // Peak (and loudness) after mixing to the output channels, measured in float so nothing clips.
    const pcm = join(dir, "mix.wav");
    await encode(f, file, pcm, 0, fadeStart, "pcm");
    const peakGain = target - (await probe(pcm)).peakDb;
    // Loops aim for a loudness, but never past the peak ceiling (spec 06 § Loudness).
    const wanted = f.lufs === null ? peakGain : Math.min(peakGain, f.lufs - (await loudness(pcm)));
    let gainDb = Math.round(wanted * 10) / 10;
    // AAC can overshoot the source's peak by a few dB; the peak is a ceiling (spec 06), so turn
    // it down by the overshoot and encode again.
    for (let i = 0; ; i++) {
      await encode(f, file, out, gainDb, fadeStart);
      const over = (await probe(out)).peakDb - target;
      if (over <= 0.1) break;
      if (i + 1 >= MAX_TRIES) {
        throw new Error(`still ${over.toFixed(1)} dB over the ${target} dBFS peak after encoding`);
      }
      gainDb = Math.round((gainDb - over - 0.1) * 10) / 10;
    }
    return { bytes: new Uint8Array(readFileSync(out)), seconds, gainDb };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
