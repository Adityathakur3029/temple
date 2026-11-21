/**
 * Asset checks for `npm run check` (spec 11 § Acceptance criteria): the config is valid, the
 * built files match the manifest and the config, every file is within its slot's budgets and
 * carries its licence and credit, and only scene code can load models (spec 08: no deity image
 * in UI, loading or donation code).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LICENCES, NO_CREDIT_NEEDED, type AssetManifest } from "../../apps/web/src/assets/manifest";
import {
  MODEL_TEXTURE_BYTES,
  MODEL_TRIANGLES,
  SLOTS,
  isSlotId,
} from "../../apps/web/src/assets/slots";
import type { AssetConfig } from "../assets/config";
import {
  RELEASES_DIR,
  fileOnDisk,
  inputsHash,
  readConfig,
  readManifest,
  releaseHash,
  sha256,
} from "../assets/inputs";

const STALE = "the built models are out of date; run `npm run assets:build`";

/**
 * The worst view: every model's triangles times its copies, and every texture's GPU memory,
 * per tier, against what spec 10 leaves for models (MODEL_TRIANGLES, MODEL_TEXTURE_BYTES).
 */
export function checkTotals(manifest: AssetManifest): string[] {
  const problems: string[] = [];
  for (const tier of ["full", "lite"] as const) {
    // The avatar (a rig slot) has its own share of the budget (spec 10).
    const files = manifest.files.filter(
      (f) => f.tier === tier && isSlotId(f.slot) && SLOTS[f.slot].kind !== "rig",
    );
    const triangles = files.reduce(
      (n, f) => n + f.triangles * (SLOTS[f.slot].copies?.[tier] ?? 1),
      0,
    );
    if (triangles > MODEL_TRIANGLES[tier]) {
      problems.push(
        `${tier} models: ${triangles.toLocaleString("en")} triangles counting every copy > ${MODEL_TRIANGLES[tier].toLocaleString("en")} (spec 10)`,
      );
    }
    const gpu = files.reduce((n, f) => n + f.gpuBytes, 0);
    if (gpu > MODEL_TEXTURE_BYTES[tier]) {
      problems.push(
        `${tier} models: about ${(gpu / 1e6).toFixed(0)} MB of GPU textures > ${MODEL_TEXTURE_BYTES[tier] / 1e6} MB (spec 10)`,
      );
    }
  }
  return problems;
}

/** Problems in a manifest against the config and the files on disk. */
export function checkManifest(
  manifest: AssetManifest,
  config: AssetConfig,
  readFile: (path: string) => Uint8Array | null,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of manifest.files) {
    const where = `manifest ${f.src} (${f.tier})`;
    if (!isSlotId(f.slot)) {
      problems.push(`${where}: unknown slot "${String(f.slot)}"`);
      continue;
    }
    const spec = SLOTS[f.slot];
    seen.add(`${f.slot}|${f.tier}`);
    if (f.path !== `/v/${manifest.release}/${f.tier}/${f.src}`) {
      problems.push(`${where}: path ${f.path} is not under release ${manifest.release}`);
    }
    const data = readFile(f.path);
    if (!data) problems.push(`${where}: ${f.path} is missing; ${STALE}`);
    else if (data.byteLength !== f.bytes || sha256(data) !== f.sha256) {
      problems.push(`${where}: file doesn't match its sha256 or size; ${STALE}`);
    }
    if (f.triangles > spec.maxTriangles) {
      problems.push(`${where}: ${f.triangles} triangles > ${spec.maxTriangles} (spec 11)`);
    }
    if (f.draws > spec.maxDraws) problems.push(`${where}: ${f.draws} draws > ${spec.maxDraws}`);
    if (f.priority !== spec.priority)
      problems.push(`${where}: priority should be ${spec.priority}`);
    if (!(LICENCES as readonly string[]).includes(f.licence)) {
      problems.push(`${where}: licence "${f.licence}" is not allowed`);
    } else if (!NO_CREDIT_NEEDED.includes(f.licence) && !f.credit) {
      problems.push(`${where}: ${f.licence} needs a credit line`);
    }
    if (spec.sacred !== f.tags.includes("sacred")) {
      problems.push(`${where}: the "sacred" tag must match the slot (spec 08)`);
    }
    const cfg = config.slots[f.slot];
    if (!cfg) problems.push(`${where}: slot isn't in assets-src/slots.json; ${STALE}`);
    else if (cfg.licence !== f.licence || cfg.credit !== f.credit) {
      problems.push(`${where}: licence or credit differs from slots.json; ${STALE}`);
    }
  }
  for (const slot of Object.keys(config.slots)) {
    for (const tier of ["full", "lite"]) {
      if (!seen.has(`${slot}|${tier}`)) problems.push(`slot ${slot} has no ${tier} file; ${STALE}`);
    }
  }
  problems.push(...checkTotals(manifest));
  const expected = manifest.files.length > 0 ? releaseHash(manifest.files) : null;
  if (manifest.release !== expected) {
    problems.push(`manifest release ${manifest.release} should be ${expected}; ${STALE}`);
  }
  return problems;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

/**
 * Only scene code (src/scene, src/assets) may load the asset manifest, the model loader or a
 * built model, so no sacred model can reach UI icons, boot or loading screens, or donation
 * prompts. `extra` adds files outside src (index.html). The favicon and app icon are static
 * files, checked by review (spec 08).
 */
export function checkModelImports(webSrc: string, extra: readonly string[] = []): string[] {
  const allowed = [join(webSrc, "scene"), join(webSrc, "assets")];
  // Imports or re-exports of the manifest or the loader, and built-model paths (/v/…, .glb).
  const patterns = [
    /(from\s+|import\s*\(\s*)["'][^"']*(assets\/manifest|scene\/models)/,
    /["'`(]\/v\/[0-9a-f]/,
    /\.glb\b/,
  ];
  const problems: string[] = [];
  for (const file of [...listFiles(webSrc), ...extra.filter((f) => existsSync(f))]) {
    if (!/\.([cm]?[tj]sx?|html?|css)$/.test(file)) continue;
    if (allowed.some((dir) => file.startsWith(dir))) continue;
    const text = readFileSync(file, "utf8");
    if (patterns.some((p) => p.test(text))) {
      problems.push(
        `${relative(webSrc, file).replace(/\\/g, "/")}: only scene code may load models (spec 08, spec 11)`,
      );
    }
  }
  return problems;
}

export function checkAssets(root: string): string[] {
  const { config, problems, raw } = readConfig();
  let manifest: AssetManifest;
  try {
    manifest = readManifest();
  } catch (err) {
    return [...problems, `asset manifest: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (problems.length === 0 && manifest.inputs !== inputsHash(config, raw)) {
    problems.push(`assets-src/ changed since the last build; ${STALE}`);
  }
  problems.push(
    ...checkManifest(manifest, config, (path) => {
      const disk = fileOnDisk(path);
      return existsSync(disk) ? readFileSync(disk) : null;
    }),
  );
  const listed = new Set(manifest.files.map((f) => fileOnDisk(f.path)));
  for (const file of listFiles(RELEASES_DIR)) {
    if (!listed.has(file)) {
      problems.push(`${relative(root, file).replace(/\\/g, "/")} isn't in the manifest; ${STALE}`);
    }
  }
  problems.push(
    ...checkModelImports(join(root, "apps/web/src"), [join(root, "apps/web/index.html")]),
  );
  return problems;
}
