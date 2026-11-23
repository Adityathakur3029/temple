/**
 * The sound config, `assets-src/sounds.json` (spec 11 § Sounds): which source clips fill which
 * sound, with their licence and credit. Validated strictly, like slots.json, so a typo or a
 * missing licence fails the build instead of shipping.
 */
import { LICENCES, NO_CREDIT_NEEDED, type Licence } from "../../apps/web/src/assets/manifest";
import { SOUNDS, isSoundId, type SoundId } from "../../apps/web/src/assets/sounds";
import type { ConfigEnv } from "./config";

export interface SoundConfig {
  /** Source clips, relative to assets-src/: `.wav` (best), `.flac` or `.mp3`. One per variant. */
  files: string[];
  licence: Licence;
  credit: string | null;
  /** A stand-in until the final recordings. */
  interim: boolean;
  /** Made with an AI tool; disclosed in the credits (spec 11). */
  ai: boolean;
}

export type SoundsConfig = Partial<Record<SoundId, SoundConfig>>;

const KEYS = new Set(["files", "licence", "credit", "interim", "ai", "notes"]);

/** Built name of variant `i` (0-based): `audio/bell-1.m4a`. */
export function soundSrc(sound: SoundId, i: number): string {
  return `audio/${sound}-${i + 1}.m4a`;
}

/** The LICENSES.md heading each built variant needs (spec 11 § LICENSES.md entry format). */
export function soundLicenceHeading(sound: SoundId, i: number): string {
  return `## ${soundSrc(sound, i)}`;
}

export function parseSoundConfig(
  raw: unknown,
  env: ConfigEnv,
): { sounds: SoundsConfig; problems: string[] } {
  const problems: string[] = [];
  const sounds: SoundsConfig = {};
  if (raw === undefined) return { sounds, problems };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { sounds, problems: ['sounds.json must be an object like { "sounds": { … } }'] };
  }
  const table = (raw as { sounds?: unknown }).sounds;
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    return { sounds, problems: ['sounds.json needs a "sounds" object'] };
  }
  const headings = new Set(env.licences.split(/\r?\n/).map((l) => l.trim()));

  for (const [id, value] of Object.entries(table as Record<string, unknown>)) {
    const where = `sounds.${id}`;
    if (!isSoundId(id)) {
      problems.push(`${where}: unknown sound (see apps/web/src/assets/sounds.ts)`);
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

    const files = v.files;
    const max = SOUNDS[id].maxVariants;
    if (!Array.isArray(files) || files.length === 0 || files.length > max) {
      problems.push(`${where}.files: a list of 1 to ${max} source clips`);
    } else {
      files.forEach((file: unknown, i) => {
        const at = `${where}.files[${i}]`;
        if (typeof file !== "string" || !/\.(wav|flac|mp3)$/i.test(file)) {
          problems.push(`${at}: a .wav, .flac or .mp3 path under assets-src/`);
        } else if (file.includes("..") || /^[\\/]/.test(file) || /^[a-z]:/i.test(file)) {
          problems.push(`${at}: must be a relative path inside assets-src/`);
        } else if (!env.exists(file)) {
          problems.push(`${at}: assets-src/${file} not found`);
        }
        if (!headings.has(soundLicenceHeading(id, i))) {
          problems.push(
            `${at}: assets-src/LICENSES.md has no "${soundLicenceHeading(id, i)}" entry`,
          );
        }
      });
      if (new Set(files).size !== files.length) problems.push(`${where}.files: listed twice`);
    }

    const licence = v.licence;
    if (typeof licence !== "string" || !(LICENCES as readonly string[]).includes(licence)) {
      problems.push(
        `${where}.licence: one of ${LICENCES.join(", ")} (NC, ND and personal-use licences are not allowed)`,
      );
    } else if (licence === "OFL") {
      problems.push(`${where}.licence: OFL is for fonts, not sounds`);
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
      problems.push(`${where}.interim: true for a stand-in, false for the final recording`);
    }
    const ai = v.ai ?? false;
    if (typeof ai !== "boolean") problems.push(`${where}.ai: true or false`);
    if (ai === true && credit === null) {
      problems.push(`${where}.credit: AI-made content is disclosed in the credits (spec 11)`);
    }
    if (v.notes !== undefined && typeof v.notes !== "string") {
      problems.push(`${where}.notes: text`);
    }

    if (problems.length === before) {
      sounds[id] = {
        files: files as string[],
        licence: licence as Licence,
        credit: credit as string | null,
        interim: v.interim as boolean,
        ai: ai as boolean,
      };
    }
  }
  return { sounds, problems };
}

/** Manifest tags for a sound (spec 11 § Manifest). */
export function soundTags(sound: SoundId, cfg: SoundConfig): string[] {
  const tags: string[] = [sound];
  if (cfg.interim) tags.push("interim");
  if (cfg.ai) tags.push("ai");
  return tags;
}
