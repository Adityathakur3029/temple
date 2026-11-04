import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import hi from "../src/i18n/hi.json";

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("locale files (spec 07 § Language)", () => {
  it("have the same keys", () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
  });

  it("use the same {placeholders} for each key", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders((hi as Record<string, string>)[key] ?? ""), key).toEqual(
        placeholders(value),
      );
    }
  });

  it("have no empty strings and no exclamation marks (spec 07 § Tone of voice)", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(hi)]) {
      expect(value.trim(), key).not.toBe("");
      expect(value, key).not.toContain("!");
    }
  });
});
