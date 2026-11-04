import { describe, expect, it } from "vitest";
import { istDate } from "../src/index";

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
