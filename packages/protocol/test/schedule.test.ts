import { describe, expect, it } from "vitest";
import {
  DAY_PHASE_STARTS_IST,
  PHASE_BLEND_MS,
  dayPhase,
  istDate,
  istMinutes,
  istTimeOnDay,
  phaseBlend,
} from "../src/index";

describe("istDate", () => {
  it("rolls over at 00:00 IST, which is 18:30 UTC the day before", () => {
    expect(istDate(Date.parse("2026-11-02T18:29:59.999Z"))).toBe("2026-11-02");
    expect(istDate(Date.parse("2026-11-02T18:30:00.000Z"))).toBe("2026-11-03");
  });

  it("handles month and year ends", () => {
    expect(istDate(Date.parse("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
    expect(istDate(Date.parse("2028-02-28T18:30:00Z"))).toBe("2028-02-29");
  });

  it("is the same date at both ends of an IST day", () => {
    expect(istDate(Date.parse("2026-11-03T00:00:00+05:30"))).toBe("2026-11-03");
    expect(istDate(Date.parse("2026-11-03T23:59:59+05:30"))).toBe("2026-11-03");
  });
});

describe("day phases (spec 02 § Light and time)", () => {
  const at = (iso: string): number => Date.parse(iso);

  it("follows the IST table", () => {
    expect(dayPhase(at("2026-11-04T03:00:00+05:30"))).toBe("night");
    expect(dayPhase(at("2026-11-04T05:29:59+05:30"))).toBe("night");
    expect(dayPhase(at("2026-11-04T05:30:00+05:30"))).toBe("dawn");
    expect(dayPhase(at("2026-11-04T06:29:59+05:30"))).toBe("dawn");
    expect(dayPhase(at("2026-11-04T06:30:00+05:30"))).toBe("day");
    expect(dayPhase(at("2026-11-04T12:00:00+05:30"))).toBe("day");
    expect(dayPhase(at("2026-11-04T17:30:00+05:30"))).toBe("dusk");
    expect(dayPhase(at("2026-11-04T18:30:00+05:30"))).toBe("night");
    expect(dayPhase(at("2026-11-04T23:59:59+05:30"))).toBe("night");
  });

  it("is the same moment-for-moment whatever offset the instant is written in", () => {
    // 19:00 IST written from several device time zones.
    for (const iso of [
      "2026-11-04T19:00:00+05:30",
      "2026-11-04T13:30:00Z",
      "2026-11-04T08:30:00-05:00",
      "2026-11-05T00:30:00+11:00",
      "2026-11-04T01:30:00-12:00",
      "2026-11-05T03:30:00+14:00",
    ]) {
      expect(dayPhase(at(iso)), iso).toBe("night");
      expect(istMinutes(at(iso)), iso).toBeCloseTo(19 * 60);
    }
  });

  it("wraps at midnight IST", () => {
    expect(istMinutes(at("2026-11-04T18:29:59.999Z"))).toBeGreaterThan(1439.99);
    expect(istMinutes(at("2026-11-04T18:30:00.000Z"))).toBe(0);
    expect(istMinutes(at("1969-12-31T23:00:00Z"))).toBeCloseTo(4 * 60 + 30);
  });

  it("blends each change over the 10 minutes after it", () => {
    expect(phaseBlend(at("2026-11-04T05:30:00+05:30"))).toEqual({
      from: "night",
      to: "dawn",
      t: 0,
    });
    const mid = phaseBlend(at("2026-11-04T17:35:00+05:30"));
    expect(mid.from).toBe("day");
    expect(mid.to).toBe("dusk");
    expect(mid.t).toBeCloseTo(0.5);
    expect(phaseBlend(at("2026-11-04T18:40:00+05:30"))).toEqual({
      from: "night",
      to: "night",
      t: 1,
    });
    expect(phaseBlend(at("2026-11-04T03:00:00+05:30"))).toEqual({
      from: "night",
      to: "night",
      t: 1,
    });
    expect(PHASE_BLEND_MS).toBe(600000);
  });

  it("shows the new phase fully within 10 minutes of each change (spec 02 § Acceptance)", () => {
    for (const [phase, start] of DAY_PHASE_STARTS_IST) {
      const b = phaseBlend(at(`2026-11-04T${start}:00+05:30`) + PHASE_BLEND_MS);
      expect(b).toEqual({ from: phase, to: phase, t: 1 });
    }
  });

  it("finds a given IST time on the same IST day", () => {
    const now = at("2026-11-04T23:50:00+05:30");
    expect(istTimeOnDay(now, "19:05")).toBe(at("2026-11-04T19:05:00+05:30"));
    const early = at("2026-11-04T00:10:00+05:30");
    expect(istTimeOnDay(early, "05:45")).toBe(at("2026-11-04T05:45:00+05:30"));
  });
});
