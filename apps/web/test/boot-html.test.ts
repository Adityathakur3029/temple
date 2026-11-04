import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import hi from "../src/i18n/hi.json";
import { jsStringBody, renderBootHtml } from "../vite-plugins/boot-html";

const read = (path: string): string =>
  readFileSync(resolve(import.meta.dirname, "../src", path), "utf8");

describe("renderBootHtml", () => {
  const locales = {
    en: { greet: "Hello <you>", lang: "English" },
    hi: { greet: "नमस्ते", lang: "English" },
  };

  it("renders both languages, escaped, for {{t:key}}", () => {
    expect(renderBootHtml("<p>{{t:greet}}</p>", locales, read)).toBe(
      '<p><span data-l="en" lang="en">Hello &lt;you&gt;</span><span data-l="hi" lang="hi">नमस्ते</span></p>',
    );
  });

  it("renders English only for {{en:key}} and shared text for {{raw:key}}", () => {
    expect(renderBootHtml("{{en:greet}}|{{raw:lang}}", locales, read)).toBe(
      "Hello &lt;you&gt;|English",
    );
    expect(() => renderBootHtml("{{raw:greet}}", locales, read)).toThrow(/same text/);
  });

  it("escapes {{hijs:key}} for a JS string inside <script>", () => {
    expect(jsStringBody('a "b" \\ </script>')).toBe('a \\"b\\" \\\\ \\u003c/script>');
  });

  it("fails the build on a missing key", () => {
    expect(() => renderBootHtml("{{t:nope}}", locales, read)).toThrow(/missing string "nope"/);
  });

  it("turns the mark into a coloured data: URI favicon", () => {
    const uri = renderBootHtml("{{favicon:ui/shikhara.svg}}", locales, read);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(uri)).not.toContain("currentColor");
  });
});

describe("index.html", () => {
  const html = renderBootHtml(
    readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8"),
    { en, hi },
    read,
  );

  it("has no unrendered tokens", () => {
    expect(html).not.toMatch(/\{\{[^}]*\}\}/);
  });

  it("shows the boot strings in both languages without JavaScript", () => {
    for (const key of [
      "boot.title",
      "boot.opening",
      "boot.retry",
      "unsupported.title",
      "boot.error",
    ] as const) {
      expect(html).toContain(`<span data-l="en" lang="en">${en[key]}</span>`);
      expect(html).toContain(`<span data-l="hi" lang="hi">${hi[key]}</span>`);
    }
  });

  it("inlines the language detection script", () => {
    const inline = /<script>([^<]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(inline.startsWith("(function () {\nvar lang = null;")).toBe(true);
    expect(inline).toContain('localStorage.getItem("sannidhi:lang-v1")');
    expect(inline).toContain("document.documentElement.lang = lang;");
    expect(inline).toContain(`if (lang === "hi") document.title = "${hi["boot.title"]}";`);
    expect(inline).not.toContain("{{");
  });

  it("loads nothing from other hosts", () => {
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
