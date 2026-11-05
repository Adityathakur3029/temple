/**
 * The asset manifest (spec 11 § Manifest). `npm run assets:build` writes manifest.json next to
 * this file; the client reads every asset URL from it and never hard-codes one (spec 01).
 */
import type { Priority, SlotId } from "./slots";

export type AssetTier = "full" | "lite";

/** Licences an asset may have (spec 11 § Licensing rules). Commissioned work is `own`. */
export const LICENCES = ["own", "CC0", "CC-BY-4.0", "OFL"] as const;
export type Licence = (typeof LICENCES)[number];

/** Licences that need no credit line. Everything else must carry one. */
export const NO_CREDIT_NEEDED: readonly Licence[] = ["own", "CC0", "OFL"];

export interface ManifestFile {
  /** Tier-independent name, e.g. `models/bell.glb`. */
  src: string;
  slot: SlotId;
  tier: AssetTier;
  /** Versioned path on the asset origin: `/v/<release>/<tier>/<src>`. */
  path: string;
  sha256: string;
  bytes: number;
  priority: Priority;
  /** `sacred` for deities and sacred objects; `interim` for a stand-in until final art (M5). */
  tags: string[];
  licence: Licence;
  credit: string | null;
  triangles: number;
  draws: number;
  /** Width and height of each texture in this file. */
  textures: [number, number][];
  /** Estimated GPU memory for the textures with mipmaps, at 8 bits per pixel (BC7, ASTC). */
  gpuBytes: number;
}

export interface AssetManifest {
  /** Short hash of the file list; null while no asset has been built. */
  release: string | null;
  /** Hash of the asset config, the source files and the build settings, to spot stale builds. */
  inputs: string | null;
  files: ManifestFile[];
}
