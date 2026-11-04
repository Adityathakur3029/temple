/**
 * The in-temple string loader (spec 07 § Language). Both locale files ship with the scene chunk;
 * the boot screen gets its strings at build time instead (vite-plugins/boot-html.ts).
 */
import en from "./en.json";
import hi from "./hi.json";
import { type Lang, currentLang } from "./lang";

export type StringKey = keyof typeof en;

// `satisfies` makes a missing Hindi key a type error, on top of the parity test.
const TABLES = { en, hi } satisfies Record<Lang, Record<StringKey, string>>;

/** Fills `{name}` placeholders. Unknown placeholders are left as written. */
export function format(
  template: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

export function t(
  key: StringKey,
  params?: Readonly<Record<string, string | number>>,
  lang: Lang = currentLang(),
): string {
  return format(TABLES[lang][key], params);
}

/**
 * Fills every `[data-t]` element's text and every `[data-t-label]` element's aria-label under
 * `root`, in the current language. Call again after a language change.
 */
export function applyStrings(root: ParentNode, lang: Lang = currentLang()): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-t]")) {
    const key = el.dataset.t as StringKey;
    if (key in TABLES.en) el.textContent = t(key, undefined, lang);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-t-label]")) {
    const key = el.dataset.tLabel as StringKey;
    if (key in TABLES.en) el.setAttribute("aria-label", t(key, undefined, lang));
  }
}
