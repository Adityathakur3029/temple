/**
 * The asset config, `assets-src/slots.json` (spec 11 § Slots): which source file fills which
 * slot, its licence and credit, and how to turn and size it. Validated strictly, so a typo or a
 * missing licence fails the build instead of shipping.
 */
import { LICENCES, NO_CREDIT_NEEDED, type Licence } from "../../apps/web/src/assets/manifest";
import { SLOTS, isSlotId, type SlotId } from "../../apps/web/src/assets/slots";

export type Vec3 = [number, number, number];

export interface SlotConfig {
  /** Source file, relative to assets-src/. `.glb` or `.gltf`. */
  file: string;
  licence: Licence;
  /** Credit line shown on the credits screen; required unless the licence is own, CC0 or OFL. */
  credit: string | null;
  /** A stand-in (usually downloaded) until final art replaces it in M5. */
  interim: boolean;
  /** Made with an AI tool. Never allowed for sacred slots (spec 11 § AI-generated content). */
  ai: boolean;
  /** `auto` scales and moves the model to the slot's size and origin; `none` keeps it as made. */
  fit: "auto" | "none";
  /** Degrees about x, then y, then z, applied before fitting. */
  rotate: Vec3;
  /** Extra even scale after fitting. */
  scale: number;
  /** Metres added after fitting, in the model's own frame (front = +z). */
  offset: Vec3;
}

export interface AssetConfig {
  slots: Partial<Record<SlotId, SlotConfig>>;
}

const KEYS = new Set([
  "file",
  "licence",
  "credit",
  "interim",
  "ai",
  "fit",
  "rotate",
  "scale",
  "offset",
  "notes",
]);

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && isFinite(n));
}

export interface ConfigEnv {
  /** Whether a path relative to assets-src/ exists. */
  exists(path: string): boolean;
  /** Contents of assets-src/LICENSES.md. */
  licences: string;
}

/** The LICENSES.md heading every configured slot needs (spec 11 § LICENSES.md entry format). */
export function licenceHeading(slot: SlotId): string {
  return `## models/${slot}.glb`;
}

export function parseConfig(
  raw: unknown,
  env: ConfigEnv,
): { config: AssetConfig; problems: string[] } {
  const problems: string[] = [];
  const config: AssetConfig = { slots: {} };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config, problems: ['slots.json must be an object like { "slots": { … } }'] };
  }
  const slots = (raw as { slots?: unknown }).slots;
  if (typeof slots !== "object" || slots === null || Array.isArray(slots)) {
    return { config, problems: ['slots.json needs a "slots" object'] };
  }
  const headings = new Set(env.licences.split(/\r?\n/).map((l) => l.trim()));

  for (const [id, value] of Object.entries(slots as Record<string, unknown>)) {
    const where = `slots.${id}`;
    if (!isSlotId(id)) {
      problems.push(`${where}: unknown slot (see apps/web/src/assets/slots.ts)`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      problems.push(`${where}: must be an object`);
      continue;
    }
    const v = value as Record<string, unknown>;
    const before = problems.length;
    for (const key of Object.keys(v)) {
      if (!KEYS.has(key)) problems.push(`${where}.${key}: unknown setting`);
    }

    const file = v.file;
    if (typeof file !== "string" || !/\.(glb|gltf)$/i.test(file)) {
      problems.push(`${where}.file: a .glb or .gltf path under assets-src/`);
    } else if (file.includes("..") || /^[\\/]/.test(file) || /^[a-z]:/i.test(file)) {
      problems.push(`${where}.file: must be a relative path inside assets-src/`);
    } else if (!env.exists(file)) {
      problems.push(`${where}.file: assets-src/${file} not found`);
    }

    const licence = v.licence;
    if (typeof licence !== "string" || !(LICENCES as readonly string[]).includes(licence)) {
      problems.push(
        `${where}.licence: one of ${LICENCES.join(", ")} (NC, ND and personal-use licences are not allowed)`,
      );
    } else if (licence === "OFL") {
      problems.push(`${where}.licence: OFL is for fonts, not models`);
    }

    const credit = v.credit ?? null;
    if (credit !== null && (typeof credit !== "string" || credit.trim() === "")) {
      problems.push(`${where}.credit: a non-empty string, or leave it out`);
    }
    const needsCredit =
      typeof licence === "string" && !(NO_CREDIT_NEEDED as readonly string[]).includes(licence);
    if (needsCredit && credit === null) {
      problems.push(`${where}.credit: ${licence} needs a credit line (title, author, licence)`);
    }

    if (typeof v.interim !== "boolean") {
      problems.push(`${where}.interim: true for a stand-in, false for final art`);
    }
    const ai = v.ai ?? false;
    if (typeof ai !== "boolean") problems.push(`${where}.ai: true or false`);
    if (ai === true && SLOTS[id].sacred) {
      problems.push(`${where}.ai: AI-made models are never used for sacred forms (spec 08)`);
    }
    if (SLOTS[id].sacred) {
      // Spec 08 § Depiction: say so explicitly; many shared models are AI-made and not labelled.
      if (v.ai !== false) {
        problems.push(`${where}.ai: sacred forms need an explicit "ai": false (spec 08)`);
      }
      // Only work made for Sannidhi can be final; anything downloaded stays a stand-in.
      if (licence !== "own" && v.interim !== true) {
        problems.push(`${where}.interim: a downloaded sacred form is always a stand-in (spec 08)`);
      }
    }
    if (ai === true && credit === null) {
      problems.push(`${where}.credit: AI-made content is disclosed in the credits (spec 11)`);
    }

    const fit = v.fit ?? "auto";
    if (fit !== "auto" && fit !== "none") problems.push(`${where}.fit: "auto" or "none"`);
    const rotate = v.rotate ?? [0, 0, 0];
    if (!isVec3(rotate)) problems.push(`${where}.rotate: [x, y, z] in degrees`);
    const scale = v.scale ?? 1;
    if (typeof scale !== "number" || !(scale > 0) || !isFinite(scale)) {
      problems.push(`${where}.scale: a number above 0`);
    }
    const offset = v.offset ?? [0, 0, 0];
    if (!isVec3(offset)) problems.push(`${where}.offset: [x, y, z] in metres`);
    if (v.notes !== undefined && typeof v.notes !== "string") {
      problems.push(`${where}.notes: text`);
    }

    if (!headings.has(licenceHeading(id))) {
      problems.push(`${where}: assets-src/LICENSES.md has no "${licenceHeading(id)}" entry`);
    }

    if (problems.length === before) {
      config.slots[id] = {
        file: file as string,
        licence: licence as Licence,
        credit: credit as string | null,
        interim: v.interim as boolean,
        ai: ai as boolean,
        fit: fit as "auto" | "none",
        rotate: rotate as Vec3,
        scale: scale as number,
        offset: offset as Vec3,
      };
    }
  }
  return { config, problems };
}

/** Manifest tags for a slot (spec 11 § Manifest). */
export function tagsFor(slot: SlotId, cfg: SlotConfig): string[] {
  const tags: string[] = [slot];
  if (SLOTS[slot].sacred) tags.push("sacred");
  if (cfg.interim) tags.push("interim");
  if (cfg.ai) tags.push("ai");
  return tags;
}
