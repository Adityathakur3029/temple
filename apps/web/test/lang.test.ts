import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANG_KEY, currentLang, initLangToggle, setLang } from "../src/i18n/lang";

const detectScript = readFileSync(
  resolve(import.meta.dirname, "../src/i18n/detect-lang.js"),
  "utf8",
);

function runDetect(): string {
  document.documentElement.lang = "";
  // Run the inline head script's source as-is, the way the browser does.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const script = new Function(detectScript) as () => void;
  script();
  return document.documentElement.lang;
}

function setNavigatorLanguage(value: string): void {
  vi.spyOn(navigator, "language", "get").mockReturnValue(value);
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = `
    <h1 class="boot-title"><span data-l="en">Sannidhi</span><span data-l="hi">सन्निधि</span></h1>
    <button data-lang="hi">हिन्दी</button><button data-lang="en">English</button>`;
});

describe("detect-lang.js (first paint)", () => {
  it("reads the same storage key as lang.ts", () => {
    expect(detectScript).toContain(`"${LANG_KEY}"`);
  });

  it("defaults to Hindi when navigator.language starts with hi", () => {
    setNavigatorLanguage("hi-IN");
    expect(runDetect()).toBe("hi");
    setNavigatorLanguage("hi");
    expect(runDetect()).toBe("hi");
  });

  it("defaults to English otherwise", () => {
    for (const value of ["en-IN", "en-US", "ta-IN", "mr", ""]) {
      setNavigatorLanguage(value);
      expect(runDetect(), value).toBe("en");
    }
  });

  it("prefers the stored choice", () => {
    setNavigatorLanguage("hi-IN");
    localStorage.setItem(LANG_KEY, "en");
    expect(runDetect()).toBe("en");
  });

  it("ignores an invalid stored value and survives blocked storage", () => {
    setNavigatorLanguage("hi-IN");
    localStorage.setItem(LANG_KEY, "fr");
    expect(runDetect()).toBe("hi");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runDetect()).toBe("hi");
  });
});

describe("language toggle", () => {
  it("switches <html lang>, stores the choice and updates the buttons and title", () => {
    document.documentElement.lang = "en";
    initLangToggle();
    const hiButton = document.querySelector<HTMLButtonElement>('[data-lang="hi"]');
    expect(hiButton?.getAttribute("aria-pressed")).toBe("false");

    hiButton?.click();
    expect(currentLang()).toBe("hi");
    expect(localStorage.getItem(LANG_KEY)).toBe("hi");
    expect(hiButton?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-lang="en"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(document.title).toBe("सन्निधि");
  });

  it("still switches when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setLang("hi");
    expect(currentLang()).toBe("hi");
  });
});
