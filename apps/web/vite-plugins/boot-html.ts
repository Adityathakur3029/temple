import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Fills the static boot screen in index.html from the locale files and source SVGs, so it
 * renders without any JavaScript (spec 01 § Boot sequence) while every string still comes
 * from i18n/en.json and i18n/hi.json (spec 07).
 *
 * Tokens:
 *   {{t:key}}          both languages, as <span data-l="en" lang="en">…</span><span data-l="hi" …>;
 *                      CSS shows the one matching <html lang>
 *   {{en:key}}         the English text only (for <title>; main.ts updates it on toggle)
 *   {{raw:key}}        the text as written, identical in both files (language names)
 *   {{svg:path}}       an SVG from src/, inlined
 *   {{favicon:path}}   an SVG from src/ as a data: URI with a fixed fill colour
 *   {{script:path}}    a plain script from src/, inlined; inside it, "{{hijs:key}}" becomes
 *                      the Hindi text escaped for a JS string (the Hindi tab title)
 */

export type Locale = Record<string, string>;

const FAVICON_FILL = "#8a6a2a";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text safe inside a double-quoted JS string in an inline <script>: no quote, backslash or "</" breakouts. */
export function jsStringBody(s: string): string {
  return JSON.stringify(s).slice(1, -1).replace(/</g, "\\u003c");
}

export function renderBootHtml(
  html: string,
  locales: { en: Locale; hi: Locale },
  readSource: (path: string) => string,
): string {
  const text = (lang: "en" | "hi", key: string): string => {
    const value = locales[lang][key];
    if (value === undefined)
      throw new Error(`index.html uses missing string "${key}" (${lang}.json)`);
    return escapeHtml(value);
  };
  const hiText = (key: string): string => {
    const value = locales.hi[key];
    if (value === undefined)
      throw new Error(`inline script uses missing string "${key}" (hi.json)`);
    return value;
  };

  return html.replace(
    /\{\{(t|en|raw|svg|favicon|script):([\w./-]+)\}\}/g,
    (_, kind: string, arg: string) => {
      switch (kind) {
        case "t":
          return `<span data-l="en" lang="en">${text("en", arg)}</span><span data-l="hi" lang="hi">${text("hi", arg)}</span>`;
        case "en":
          return text("en", arg);
        case "raw": {
          const en = text("en", arg);
          if (en !== text("hi", arg))
            throw new Error(`{{raw:${arg}}} needs the same text in both locales`);
          return en;
        }
        case "svg":
          return readSource(arg).trim();
        case "favicon": {
          const svg = readSource(arg)
            .trim()
            .replace(/currentColor/g, FAVICON_FILL);
          return `data:image/svg+xml,${encodeURIComponent(svg)}`;
        }
        default:
          // Drop whole-line comments (the HTML budget is 15 KB, spec 10), then fill
          // {{hijs:key}} inside the script's string literals. Lines stay separate so a
          // trailing comment or a missing semicolon can't break the rest of the script.
          return readSource(arg)
            .split(/\r?\n/)
            .filter((line) => !/^\s*\/\//.test(line))
            .map((line) => line.trim())
            .join("\n")
            .replace(/\{\{hijs:([\w./-]+)\}\}/g, (_m, key: string) => jsStringBody(hiText(key)));
      }
    },
  );
}

export function bootHtml(): Plugin {
  // import.meta.url (not import.meta.dirname): Vite rewrites it when it bundles the config.
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const read = (path: string): string => readFileSync(resolve(src, path), "utf8");
  const readLocale = (lang: string): Locale => JSON.parse(read(`i18n/${lang}.json`)) as Locale;

  return {
    name: "sannidhi-boot-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => renderBootHtml(html, { en: readLocale("en"), hi: readLocale("hi") }, read),
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(src) && /\.(json|svg)$|detect-lang\.js$/.test(file)) {
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}
