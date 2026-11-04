import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import hi from "../src/i18n/hi.json";
import { format, t } from "../src/i18n/t";

// jsdom gives import.meta.url an http: scheme, so resolve from this file's directory instead.
const spec = readFileSync(
  resolve(import.meta.dirname, "../../../specs/07-ui-and-language.md"),
  "utf8",
);

/** Rows of the table under "## Starter string table": [key, English, Hindi]. */
function starterTable(): [string, string, string][] {
  const start = spec.indexOf("## Starter string table");
  const end = spec.indexOf("\n## ", start + 1);
  return spec
    .slice(start, end)
    .split(/\r?\n/)
    .filter((l) => /^\| `/.test(l))
    .map((l) => {
      const cells = l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      return [(cells[0] ?? "").replace(/`/g, ""), cells[1] ?? "", cells[2] ?? ""];
    });
}

describe("locale files match spec 07 § Starter string table", () => {
  const rows = starterTable();
  const enTable = en as Record<string, string>;
  const hiTable = hi as Record<string, string>;

  it("reads the table", () => {
    expect(rows.length).toBeGreaterThan(70);
  });

  it.each(rows)("%s", (key, english, hindi) => {
    expect(enTable[key]).toBe(english);
    expect(hiTable[key]).toBe(hindi);
  });

  it("documents every string the locale files contain", () => {
    const documented = new Set(rows.map(([k]) => k));
    expect(Object.keys(en).filter((k) => !documented.has(k))).toEqual([]);
  });
});

describe("t()", () => {
  it("fills {placeholders} in the chosen language", () => {
    expect(t("hud.hall", { n: 3 }, "en")).toBe("Hall 3");
    expect(t("hud.hall", { n: 3 }, "hi")).toBe("कक्ष 3");
    expect(t("japa.count", { bead: 9 }, "hi")).toBe("9 / 108");
  });

  it("leaves unknown placeholders as written", () => {
    expect(format("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("follows <html lang>", () => {
    document.documentElement.lang = "hi";
    expect(t("action.darshan")).toBe("दर्शन");
    document.documentElement.lang = "en";
    expect(t("action.darshan")).toBe("Darshan");
  });
});
