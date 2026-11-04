import { describe, expect, it } from "vitest";
import { decodeServerMessage, parseResumeToken, roundCm, roundYaw } from "../src/index";

describe("rounding", () => {
  it("rounds positions to 1 cm", () => {
    expect(roundCm(1.23456)).toBe(1.23);
    expect(roundCm(-45.675)).toBeCloseTo(-45.67, 10);
    expect(roundCm(58)).toBe(58);
  });

  it("rounds yaw to 0.01 rad and wraps it", () => {
    expect(roundYaw(1.23456)).toBe(1.23);
    expect(roundYaw(2 * Math.PI + 0.5)).toBe(0.5);
    expect(roundYaw(-Math.PI / 2)).toBe(-1.57);
  });
});

describe("parseResumeToken", () => {
  const rand = "AbCdEfGhIjKlMnOpQrSt_-";

  it("reads the hall and instance", () => {
    expect(parseResumeToken(`hall-03.2.${rand}`)).toEqual({ hall: "hall-03", instance: 2 });
    expect(parseResumeToken(`hall-20.8.${rand}`)).toEqual({ hall: "hall-20", instance: 8 });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      `hall-21.1.${rand}`,
      `hall-03.0.${rand}`,
      `hall-03.9.${rand}`,
      `hall-03.2.${rand}x`,
      `hall-03.2.${rand.slice(1)}`,
      `hall-03.2.${rand.replace("_", "+")}`,
      `hall-3.2.${rand}`,
      `x.hall-03.2.${rand}`,
    ]) {
      expect(parseResumeToken(bad), bad).toBeNull();
    }
  });
});

describe("decodeServerMessage", () => {
  it("accepts known message types", () => {
    expect(decodeServerMessage('{"t":"correct","x":1,"z":2}')).toEqual({
      t: "correct",
      x: 1,
      z: 2,
    });
  });

  it("ignores unknown types and bad frames", () => {
    for (const bad of ["pong", "[]", "null", '"x"', '{"t":"future.thing"}', '{"x":1}', "{"]) {
      expect(decodeServerMessage(bad), bad).toBeNull();
    }
  });
});
