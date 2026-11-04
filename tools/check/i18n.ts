/**
 * i18n parity (spec 07 § Language, spec 12 § CI gates): every locale file has the same keys,
 * every value is a non-empty string, and each key uses the same {placeholders} in every locale.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Locales = Record<string, Record<string, unknown>>;

function placeholders(s: string): string {
  return [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1] ?? "")
    .sort()
    .join(",");
}

export function compareLocales(locales: Locales): string[] {
  const problems: string[] = [];
  const names = Object.keys(locales);
  const allKeys = new Set(names.flatMap((n) => Object.keys(locales[n] ?? {})));

  for (const key of [...allKeys].sort()) {
    let reference: { lang: string; holes: string } | null = null;
    for (const lang of names) {
      const value = locales[lang]?.[key];
      if (value === undefined) {
        problems.push(`${lang}.json is missing "${key}"`);
        continue;
      }
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(`${lang}.json "${key}" must be a non-empty string`);
        continue;
      }
      const holes = placeholders(value);
      if (reference === null) reference = { lang, holes };
      else if (holes !== reference.holes) {
        problems.push(
          `"${key}" placeholders differ: ${reference.lang} {${reference.holes}} vs ${lang} {${holes}}`,
        );
      }
    }
  }
  return problems;
}

export function readLocales(dir: string): Locales {
  const locales: Locales = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(join(dir, file), "utf8"),
    ) as Record<string, unknown>;
  }
  return locales;
}
