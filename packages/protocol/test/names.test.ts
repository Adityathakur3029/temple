import { describe, expect, it } from "vitest";
import { NAME_KEYS, NAME_NUMBERS_EXCLUDED, NAMES, isNameKey, nameLabel } from "../src/index";
import { readSpec, section } from "./spec";

describe("NAME_NUMBERS_EXCLUDED", () => {
  it("leaves out numbers with a religious or slang meaning", () => {
    for (const n of [108, 420, 666, 786]) expect(NAME_NUMBERS_EXCLUDED).toContain(n);
  });
});

describe("NAMES (spec 05 § Names)", () => {
  it("has enough keys that names rarely repeat in an instance", () => {
    expect(NAME_KEYS.length).toBeGreaterThanOrEqual(40);
  });

  it("uses lower-case ASCII keys", () => {
    for (const key of NAME_KEYS) expect(key).toMatch(/^[a-z]+$/);
  });

  it("has distinct labels in each language", () => {
    for (const lang of ["en", "hi"] as const) {
      const labels = NAME_KEYS.map((k) => NAMES[k][lang]);
      expect(new Set(labels).size, lang).toBe(labels.length);
    }
  });

  it("writes Hindi labels in Devanagari and English labels in Latin letters", () => {
    for (const key of NAME_KEYS) {
      expect(NAMES[key].hi, key).toMatch(/^[ऀ-ॿ]+$/);
      expect(NAMES[key].en, key).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("includes every example word the spec lists", () => {
    const text = section(readSpec("05-server.md"), "Names");
    const line = text.split("\n").find((l) => l.includes("For example deodar")) ?? "";
    const examples = line
      .replace(/.*For example /, "")
      .replace(/\.$/, "")
      .split(",")
      .map((w) => w.trim());
    expect(examples.length).toBeGreaterThan(10);
    for (const w of examples) expect(isNameKey(w), w).toBe(true);
  });

  it("leaves out words with a deity, ritual or brand meaning", () => {
    // A guard against well-meant additions; the cultural reviewer checks the full list.
    const banned = [
      "tulsi",
      "bilva",
      "bel",
      "kamal",
      "lotus",
      "rudraksha",
      "ganga",
      "yamuna",
      "kailash",
      "surya",
      "chandra",
      "usha",
      "neelkanth",
      "parvat",
      "agni",
      "indra",
      "kingfisher",
      "dove",
      "stream",
      "swallow",
      "myna",
      "woodpecker",
    ];
    for (const w of banned) expect(isNameKey(w), w).toBe(false);
  });

  it("labels a name in the viewer's language", () => {
    expect(nameLabel({ key: "deodar", n: 214 }, "en")).toBe("Deodar 214");
    expect(nameLabel({ key: "deodar", n: 214 }, "hi")).toBe("देवदार 214");
    expect(nameLabel({ key: "not-a-key", n: 300 }, "en")).toBe("300");
    expect(isNameKey("toString")).toBe(false);
  });
});
