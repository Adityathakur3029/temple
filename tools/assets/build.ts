/**
 * `npm run assets:build` (spec 11 § Pipeline): builds every model configured in
 * assets-src/slots.json into Full and Lite GLBs under apps/web/public/v/<release>/, and writes
 * the asset manifest the client reads (apps/web/src/assets/manifest.json).
 *
 * Nothing is written unless every slot builds and fits its budgets.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssetManifest, ManifestFile } from "../../apps/web/src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../../apps/web/src/assets/slots";
import { tagsFor } from "./config";
import {
  ASSETS_SRC,
  MANIFEST_PATH,
  RELEASES_DIR,
  fileOnDisk,
  inputsHash,
  readConfig,
  releaseHash,
  sha256,
} from "./inputs";
import { buildSlot, gpuBytes } from "./pipeline";

const kb = (n: number): string => `${(n / 1000).toFixed(0)} kB`;

async function main(): Promise<number> {
  const { config, problems, raw } = readConfig();
  if (problems.length > 0) {
    console.error("assets-src/slots.json has problems:");
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
  if (errors.length > 0) {
    console.error("\nNothing was written. Fix these and run again:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    return 1;
  }

  const release = files.length > 0 ? releaseHash(files) : null;
  const manifest: AssetManifest = {
    release,
    inputs: inputsHash(config, raw),
    files: files.map((f) => ({ ...f, path: `/v/${release}/${f.tier}/${f.src}` })),
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
  if (release === null) rmSync(RELEASES_DIR, { recursive: true, force: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  const total = (tier: string): number =>
    manifest.files.filter((f) => f.tier === tier).reduce((n, f) => n + f.bytes, 0);
  console.log(
    release === null
      ? "\nNo models configured; every slot shows its greybox shape."
      : `\nRelease ${release}: ${manifest.files.length / 2} model(s), Full ${kb(total("full"))}, Lite ${kb(total("lite"))}.`,
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
