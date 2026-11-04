import { writeLocal } from "../platform/storage";

export type Lang = "hi" | "en";

/** Spec 09. The first-paint choice is made by detect-lang.js, which reads the same key. */
export const LANG_KEY = "sannidhi:lang-v1";

export function currentLang(doc: Document = document): Lang {
  return doc.documentElement.lang === "hi" ? "hi" : "en";
}

const listeners = new Set<(lang: Lang) => void>();

/** Called after every language switch, so in-temple UI can redraw its strings. */
export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Switch language: `<html lang>` drives which boot strings CSS shows (spec 07 § Language). */
export function setLang(lang: Lang, doc: Document = document): void {
  doc.documentElement.lang = lang;
  writeLocal(LANG_KEY, lang);
  syncLangUi(doc);
  for (const fn of listeners) fn(lang);
}

/** Pressed state on the toggle buttons and the document title, for the current language. */
export function syncLangUi(doc: Document = document): void {
  const lang = currentLang(doc);
  for (const button of doc.querySelectorAll<HTMLButtonElement>("button[data-lang]")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  }
  const title = doc.querySelector(`.boot-title [data-l="${lang}"]`)?.textContent;
  if (title) doc.title = title;
}

export function initLangToggle(doc: Document = document): void {
  for (const button of doc.querySelectorAll<HTMLButtonElement>("button[data-lang]")) {
    button.addEventListener("click", () => {
      const lang = button.dataset.lang;
      if (lang === "hi" || lang === "en") setLang(lang, doc);
    });
  }
  syncLangUi(doc);
}
