/**
 * Shared by `npm run assets:build` and `npm run check`: where asset files live, reading the
 * config, and the two hashes in the manifest (spec 11 § Manifest).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AssetManifest, ManifestFile } from "../../apps/web/src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../../apps/web/src/assets/slots";
import { ROOT } from "../lib/run";
import { parseConfig, type AssetConfig } from "./config";

/** Bump when a build setting changes, so `npm run check` asks for a rebuild. */
export const PIPELINE_VERSION = 2;

export const ASSETS_SRC = join(ROOT, "assets-src");
export const CONFIG_PATH = join(ASSETS_SRC, "slots.json");
export const LICENSES_PATH = join(ASSETS_SRC, "LICENSES.md");
/** Built files are served by the web Worker under /v/ until the asset Worker exists (spec 01). */
export const RELEASES_DIR = join(ROOT, "apps/web/public/v");
export const MANIFEST_PATH = join(ROOT, "apps/web/src/assets/manifest.json");

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function readConfig(): { config: AssetConfig; problems: string[]; raw: unknown } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { config: { slots: {} }, problems: [`assets-src/slots.json: ${msg}`], raw: null };
  }
  const licences = existsSync(LICENSES_PATH) ? readFileSync(LICENSES_PATH, "utf8") : "";
  const { config, problems } = parseConfig(raw, {
    exists: (p) => existsSync(join(ASSETS_SRC, p)),
    licences,
  });
  return { config, problems, raw };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
    .sort();
}

/**
 * Everything the built files depend on: build settings, the slot table, the config, and every
 * file in each configured model's source folder (a .gltf has its textures and buffers beside it).
 */
export function inputsHash(config: AssetConfig, raw: unknown): string {
  const h = createHash("sha256");
  h.update(`pipeline ${PIPELINE_VERSION}\n`);
  // Labels are descriptions only; everything else in the slot table changes the output.
  h.update(JSON.stringify(SLOTS, (key, value: unknown) => (key === "label" ? undefined : value)));
  h.update(JSON.stringify(raw));
  for (const slot of SLOT_IDS) {
    const cfg = config.slots[slot];
    if (!cfg) continue;
    const dir = dirname(join(ASSETS_SRC, cfg.file));
    for (const f of filesUnder(dir)) {
      h.update(`\n${relative(ASSETS_SRC, f).replace(/\\/g, "/")} `);
      h.update(sha256(readFileSync(f)));
    }
  }
  return h.digest("hex").slice(0, 16);
}

/** Short hash of the file list (spec 11: a changed asset gives a new release folder). */
export function releaseHash(
  files: readonly Pick<ManifestFile, "src" | "tier" | "sha256">[],
): string {
  const lines = files.map((f) => `${f.src}|${f.tier}|${f.sha256}`).sort();
  return sha256(lines.join("\n")).slice(0, 8);
}

export function readManifest(): AssetManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as AssetManifest;
}

/** Where a manifest path (`/v/<release>/…`) is on disk. */
export function fileOnDisk(path: string): string {
  return join(RELEASES_DIR, "..", path.replace(/^\/+/, ""));
}
