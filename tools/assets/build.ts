/**
 * `npm run assets:build` (spec 11 § Pipeline): builds every model configured in
 * assets-src/slots.json into Full and Lite GLBs, and every sound in assets-src/sounds.json into
 * `.m4a` files, under apps/web/public/v/<release>/, and writes the asset manifest the client
 * reads (apps/web/src/assets/manifest.json).
 *
 * Nothing is written unless every slot and sound builds and fits its budgets.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AssetManifest,
  ManifestFile,
  ManifestSound,
} from "../../apps/web/src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../../apps/web/src/assets/slots";
import { SOUND_IDS } from "../../apps/web/src/assets/sounds";
import { buildSound } from "./audio";
import { tagsFor } from "./config";
import {
  ASSETS_SRC,
  MANIFEST_PATH,
  RELEASES_DIR,
  fileOnDisk,
  inputsHash,
  readConfig,
  releaseOf,
  sha256,
} from "./inputs";
import { buildSlot, gpuBytes } from "./pipeline";
import { soundSrc, soundTags } from "./sound-config";

const kb = (n: number): string => `${(n / 1000).toFixed(0)} kB`;

async function main(): Promise<number> {
  const { config, sounds, problems, raw } = readConfig();
  if (problems.length > 0) {
    console.error("The asset config (assets-src/slots.json, sounds.json) has problems:");
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }

  const files: Omit<ManifestFile, "path">[] = [];
  const data = new Map<string, Uint8Array>();
  const errors: string[] = [];
  for (const slot of SLOT_IDS) {
    const cfg = config.slots[slot];
    if (!cfg) continue;
    const spec = SLOTS[slot];
    const started = Date.now();
    process.stdout.write(`▸ ${slot} (${cfg.file}) … `);
    try {
      const built = await buildSlot(slot, cfg, join(ASSETS_SRC, cfg.file));
      const src = `models/${slot}.glb`;
      for (const tier of ["full", "lite"] as const) {
        const { bytes, triangles, textures } = built.tiers[tier];
        data.set(`${tier}/${src}`, bytes);
        files.push({
          src,
          slot,
          tier,
          sha256: sha256(bytes),
          bytes: bytes.byteLength,
          priority: spec.priority,
          tags: tagsFor(slot, cfg),
          licence: cfg.licence,
          credit: cfg.credit,
          triangles,
          draws: built.draws,
          textures,
          gpuBytes: gpuBytes(textures),
        });
      }
      console.log(
        `${built.tiers.full.triangles.toLocaleString("en")} / ${spec.maxTriangles.toLocaleString("en")} triangles, ` +
          `${built.draws} / ${spec.maxDraws} draws, Full ${kb(built.tiers.full.bytes.byteLength)}, ` +
          `Lite ${kb(built.tiers.lite.bytes.byteLength)} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
      );
      for (const note of built.notes) console.log(`    ${note}`);
    } catch (err) {
      console.log("failed");
      errors.push(`${slot}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const soundFiles: Omit<ManifestSound, "path">[] = [];
  for (const sound of SOUND_IDS) {
    const cfg = sounds[sound];
    if (!cfg) continue;
    for (const [i, file] of cfg.files.entries()) {
      const src = soundSrc(sound, i);
      process.stdout.write(`▸ ${src} (${file}) … `);
      try {
        const built = await buildSound(sound, join(ASSETS_SRC, file));
        data.set(src, built.bytes);
        soundFiles.push({
          src,
          sound,
          sha256: sha256(built.bytes),
          bytes: built.bytes.byteLength,
          seconds: Math.round(built.seconds * 100) / 100,
          tags: soundTags(sound, cfg),
          licence: cfg.licence,
          credit: cfg.credit,
        });
        const gain = `${built.gainDb >= 0 ? "+" : ""}${built.gainDb} dB`;
        console.log(`${built.seconds.toFixed(1)} s, ${gain}, ${kb(built.bytes.byteLength)}`);
      } catch (err) {
        console.log("failed");
        errors.push(`${src}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (errors.length > 0) {
    console.error("\nNothing was written. Fix these and run again:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  }

  const release = releaseOf(files, soundFiles);
  const manifest: AssetManifest = {
    release,
    inputs: inputsHash(config, raw, sounds),
    files: files.map((f) => ({ ...f, path: `/v/${release}/${f.tier}/${f.src}` })),
    sounds: soundFiles.map((f) => ({ ...f, path: `/v/${release}/${f.src}` })),
  };
  // Only the current release is kept here; deployed releases are kept on the asset origin.
  mkdirSync(RELEASES_DIR, { recursive: true });
  for (const old of readdirSync(RELEASES_DIR)) {
    if (old !== release) rmSync(join(RELEASES_DIR, old), { recursive: true, force: true });
  }
  for (const f of manifest.files) {
    const target = fileOnDisk(f.path);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = data.get(`${f.tier}/${f.src}`);
    if (bytes) writeFileSync(target, bytes);
  }
  for (const f of manifest.sounds ?? []) {
    const target = fileOnDisk(f.path);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = data.get(f.src);
    if (bytes) writeFileSync(target, bytes);
  }
  if (release === null) rmSync(RELEASES_DIR, { recursive: true, force: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  const total = (tier: string): number =>
    manifest.files.filter((f) => f.tier === tier).reduce((n, f) => n + f.bytes, 0);
  const soundBytes = soundFiles.reduce((n, f) => n + f.bytes, 0);
  console.log(
    release === null
      ? "\nNo models or sounds configured; every slot shows its greybox shape."
      : `\nRelease ${release}: ${manifest.files.length / 2} model(s), Full ${kb(total("full"))}, ` +
          `Lite ${kb(total("lite"))}; ${soundFiles.length} sound file(s), ${kb(soundBytes)}.`,
  );
  console.log("Wrote apps/web/src/assets/manifest.json. Run `npm run check` before committing.");
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
