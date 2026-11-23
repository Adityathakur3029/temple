import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetManifest } from "../../apps/web/src/assets/manifest";
import { EFFECT_FORMAT, SOUNDS } from "../../apps/web/src/assets/sounds";
import { buildSound, probe } from "../assets/audio";
import { releaseOf, sha256 } from "../assets/inputs";
import { parseSoundConfig, soundLicenceHeading, soundSrc } from "../assets/sound-config";
import { checkManifest } from "../check/assets";

const licences = [soundLicenceHeading("bell", 0), soundLicenceHeading("bell", 1)].join("\n");
const env = { exists: () => true, licences };
const good = {
  files: ["audio/bell/bell-1.wav", "audio/bell/bell-2.wav"],
  licence: "own",
  credit: "Bell sounds made with an AI tool",
  interim: true,
  ai: true,
};

describe("parseSoundConfig (spec 11 § Sounds)", () => {
  it("accepts a good entry and no file at all", () => {
    expect(parseSoundConfig({ sounds: { bell: good } }, env).problems).toEqual([]);
    expect(parseSoundConfig(undefined, env)).toEqual({ sounds: {}, problems: [] });
  });

  it("rejects unknown sounds, settings, formats, too many variants and NC licences", () => {
    const problems = parseSoundConfig(
      {
        sounds: {
          conch: good,
          bell: {
            ...good,
            files: ["a.wav", "b.ogg", "c.wav", "d.wav"],
            licence: "CC-BY-NC-4.0",
            loud: true,
          },
        },
      },
      env,
    ).problems.join("\n");
    expect(problems).toMatch(/sounds\.conch: unknown sound/);
    expect(problems).toMatch(/bell\.loud: unknown setting/);
    expect(problems).toMatch(/1 to 3 source clips/);
    expect(problems).toMatch(/bell\.licence/);
  });

  it("needs a LICENSES.md entry per variant and discloses AI in the credit", () => {
    const noEntry = parseSoundConfig({ sounds: { bell: good } }, { ...env, licences: "" });
    expect(noEntry.problems.join("\n")).toMatch(/## audio\/bell-1\.m4a/);
    const quiet = parseSoundConfig({ sounds: { bell: { ...good, credit: undefined } } }, env);
    expect(quiet.problems.join("\n")).toMatch(/AI-made content is disclosed/);
  });
});

describe("sounds in the manifest", () => {
  const data = new Uint8Array([1, 2, 3]);
  const sound = {
    src: soundSrc("bell", 0),
    sound: "bell" as const,
    sha256: sha256(data),
    bytes: 3,
    seconds: 6,
    tags: ["bell", "interim", "ai"],
    licence: "own" as const,
    credit: good.credit,
  };
  const release = releaseOf([], [sound]);
  const manifest: AssetManifest = {
    release,
    inputs: null,
    files: [],
    sounds: [{ ...sound, path: `/v/${release}/audio/bell-1.m4a` }],
  };
  const cfg = { bell: { ...good, files: [good.files[0] ?? ""], licence: "own" as const } };

  it("gives a release to sounds alone, and passes when everything matches", () => {
    expect(release).toMatch(/^[0-9a-f]{8}$/);
    expect(checkManifest(manifest, { slots: {} }, () => data, cfg)).toEqual([]);
  });

  it("catches a missing file, a changed credit and an unbuilt variant", () => {
    const problems = checkManifest(manifest, { slots: {} }, () => null, {
      bell: { ...cfg.bell, credit: "other", files: good.files },
    }).join("\n");
    expect(problems).toMatch(/bell-1\.m4a is missing/);
    expect(problems).toMatch(/licence or credit differs/);
    expect(problems).toMatch(/audio\/bell-2\.m4a isn't built/);
  });
});

/** A 1 s stereo 16-bit WAV: a decaying 880 Hz tone, loud on the left only. */
function wav(): Uint8Array {
  const rate = 48_000;
  const n = rate;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 880 * i) / rate) * Math.exp(-3 * (i / rate)) * 30_000;
    b.writeInt16LE(Math.round(v), 44 + i * 4);
    b.writeInt16LE(Math.round(v * 0.2), 46 + i * 4);
  }
  return b;
}

describe("buildSound (spec 06 § Loudness and formats)", () => {
  it("encodes mono AAC peaking at no more than −6 dBFS, the same bytes every time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sannidhi-sound-test-"));
    const src = join(dir, "tone.wav");
    writeFileSync(src, wav());
    const a = await buildSound("bell", src);
    const b = await buildSound("bell", src);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const out = join(dir, "tone.m4a");
    writeFileSync(out, a.bytes);
    const { seconds, peakDb } = await probe(out);
    expect(seconds).toBeCloseTo(1, 1);
    // −6 dBFS is a ceiling; AAC's overshoot is taken off, so it may land a little under.
    expect(peakDb).toBeLessThanOrEqual(EFFECT_FORMAT.peakDb + 0.1);
    expect(peakDb).toBeGreaterThan(EFFECT_FORMAT.peakDb - 4);
    expect(a.bytes.byteLength).toBeLessThan(20_000);
  }, 60_000);

  it("refuses a clip longer than the sound allows", async () => {
    expect(SOUNDS.bell.maxSeconds).toBeLessThan(10);
    const dir = mkdtempSync(join(tmpdir(), "sannidhi-sound-test-"));
    const src = join(dir, "long.wav");
    const one = Buffer.from(wav());
    const body = Buffer.concat(Array.from({ length: 10 }, () => one.subarray(44)));
    const head = Buffer.from(one.subarray(0, 44));
    head.writeUInt32LE(36 + body.length, 4);
    head.writeUInt32LE(body.length, 40);
    writeFileSync(src, Buffer.concat([head, body]));
    await expect(buildSound("bell", src)).rejects.toThrow(/longer than/);
  }, 60_000);
});
