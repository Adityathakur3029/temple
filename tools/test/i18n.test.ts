import { describe, expect, it } from "vitest";
import { compareLocales } from "../check/i18n";

describe("compareLocales", () => {
  it("passes matching locales", () => {
    expect(
      compareLocales({
        en: { "hud.hall": "Hall {n}", "boot.title": "Sannidhi" },
        hi: { "hud.hall": "कक्ष {n}", "boot.title": "सन्निधि" },
      }),
    ).toEqual([]);
  });

  it("reports missing keys, empty values and placeholder mismatches", () => {
    expect(
      compareLocales({
        en: { a: "A", b: "{count} here", c: "C" },
        hi: { a: "", b: "{n} यहाँ", d: "D" },
      }),
    ).toEqual([
      'hi.json "a" must be a non-empty string',
      '"b" placeholders differ: en {count} vs hi {n}',
      'hi.json is missing "c"',
      'en.json is missing "d"',
    ]);
  });
});
