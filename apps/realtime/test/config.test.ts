import { describe, expect, it } from "vitest";
import { INSTANCES_PER_HALL } from "@sannidhi/protocol";
import { isAllowedOrigin, parseAllowedOrigins } from "../src/origin";
import { roomName } from "../src/rooms";

describe("parseAllowedOrigins", () => {
  it("normalises entries to canonical origins", () => {
    expect([
      ...parseAllowedOrigins(" https://Sannidhi.pages.dev/ , http://localhost:5173,"),
    ]).toEqual(["https://sannidhi.pages.dev", "http://localhost:5173"]);
  });

  it("fails loudly on a bad entry instead of locking visitors out", () => {
    expect(() => parseAllowedOrigins("sannidhi.pages.dev")).toThrow(/invalid entry/);
    expect(() => parseAllowedOrigins("ftp://x.test")).toThrow(/http\(s\)/);
  });

  it("matches the browser's Origin header exactly", () => {
    expect(isAllowedOrigin("https://sannidhi.pages.dev", "https://sannidhi.pages.dev/")).toBe(true);
    expect(
      isAllowedOrigin("https://staging.sannidhi.pages.dev", "https://sannidhi.pages.dev"),
    ).toBe(false);
    expect(isAllowedOrigin(null, "https://sannidhi.pages.dev")).toBe(false);
  });
});

describe("roomName", () => {
  it("names instances 1 … INSTANCES_PER_HALL", () => {
    expect(roomName("hall-03", 2)).toBe("hall-03#2");
    expect(roomName("hall-20", INSTANCES_PER_HALL)).toBe(`hall-20#${INSTANCES_PER_HALL}`);
  });

  it("rejects instance numbers out of range", () => {
    for (const n of [0, -1, INSTANCES_PER_HALL + 1, 1.5, Number.NaN]) {
      expect(() => roomName("hall-01", n), String(n)).toThrow(RangeError);
    }
  });
});
