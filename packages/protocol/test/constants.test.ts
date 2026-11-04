import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";
import { CLOSE_CODES, HALL_COUNT, HALL_IDS } from "../src/index";
import { readSpec, section, tableRows } from "./spec";

const spec = readSpec("04-realtime-protocol.md");

function stripTicks(cell: string): string {
  return cell.replace(/^`|`$/g, "");
}

const specConstants = new Map(
  tableRows(section(spec, "Constants")).map(([name = "", value = ""]) => [
    stripTicks(name),
    JSON.parse(stripTicks(value)) as unknown,
  ]),
);

describe("constants match spec 04 § Constants", () => {
  it("reads the spec table", () => {
    // Parser sanity check; the two tests below assert exact parity in both directions.
    expect(specConstants.size).toBeGreaterThan(30);
  });

  it.each([...specConstants])("%s", (name, value) => {
    expect(Object.hasOwn(constants, name), `${name} is exported`).toBe(true);
    expect((constants as Record<string, unknown>)[name]).toEqual(value);
  });

  it("exports no constant that the spec table doesn't list", () => {
    const exported = Object.keys(constants).filter((k) => k !== "CLOSE_CODES");
    const missing = exported.filter((k) => !specConstants.has(k));
    expect(missing).toEqual([]);
  });
});

describe("halls", () => {
  it("has hall-01 … hall-20", () => {
    expect(HALL_IDS).toHaveLength(HALL_COUNT);
    expect(HALL_IDS[0]).toBe("hall-01");
    expect(HALL_IDS[9]).toBe("hall-10");
    expect(HALL_IDS[19]).toBe("hall-20");
    expect(new Set(HALL_IDS).size).toBe(HALL_COUNT);
  });
});

describe("close codes match spec 04 § Close codes", () => {
  const rows = tableRows(section(spec, "Close codes"));

  it("has one name per code", () => {
    expect(rows.length).toBe(Object.keys(CLOSE_CODES).length);
  });

  it.each(rows.map(([code = "", name = ""]) => [stripTicks(name), Number(code)] as const))(
    "%s = %i",
    (name, code) => {
      expect((CLOSE_CODES as Record<string, number>)[name]).toBe(code);
    },
  );
});
