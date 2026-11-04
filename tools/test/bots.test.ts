import { describe, expect, it } from "vitest";
import { assign, parseArgs, percentile } from "../bots/index";

describe("bots", () => {
  it("reads the options, with defaults", () => {
    const a = parseArgs(["--hall", "hall-03", "--n", "50", "--lite", "--check", "instance"]);
    expect(a).toMatchObject({
      hall: "hall-03",
      n: 50,
      lite: true,
      check: "instance",
      url: "http://localhost:8787",
    });
    expect(() => parseArgs(["--hall", "hall-99"])).toThrow(/hall-01/);
    expect(() => parseArgs(["--mix", "dancer:1"])).toThrow(/Unknown behaviour/);
  });

  it("deals behaviours out by share", () => {
    const kinds = assign(50, [
      ["wanderer", 70],
      ["bell-ringer", 20],
      ["reconnector", 10],
    ]);
    expect(kinds).toHaveLength(50);
    expect(kinds.filter((k) => k === "wanderer")).toHaveLength(35);
    expect(kinds.filter((k) => k === "reconnector")).toHaveLength(5);
  });

  it("takes percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([], 0.95)).toBe(0);
  });
});
