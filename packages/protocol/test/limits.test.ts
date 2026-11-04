import { describe, expect, it } from "vitest";
import * as constants from "../src/constants";
import { CLIENT_MESSAGE_TYPES, RATE_LIMITS, type RateLimit } from "../src/index";
import { codeSpans, readSpec, section, tableRows } from "./spec";

const rows = tableRows(section(readSpec("04-realtime-protocol.md"), "Client → server messages"));

/** Reads one "Rate limit" cell, e.g. "1 per `BELL_COOLDOWN_MS`" or "`POS_MAX_HZ` (bucket burst 20)". */
function parseLimit(cell: string): RateLimit {
  const named = (name: string): number => {
    const v = (constants as Record<string, unknown>)[name];
    if (typeof v !== "number") throw new Error(`${name} is not a numeric constant`);
    return v;
  };
  const burst = Number(/bucket burst (\d+)/.exec(cell)?.[1] ?? 1);
  if (cell.trim() === "once") return { everyMs: Number.POSITIVE_INFINITY, burst: 1 };
  const hz = /^`(\w+_HZ)`/.exec(cell);
  if (hz?.[1]) return { everyMs: 1000 / named(hz[1]), burst };
  const per = /^1 per (?:`(\w+)`|(\d+) s)/.exec(cell);
  if (per?.[1]) return { everyMs: named(per[1]), burst };
  if (per?.[2]) return { everyMs: Number(per[2]) * 1000, burst };
  throw new Error(`Can't read rate limit "${cell}"`);
}

describe("RATE_LIMITS match spec 04 § Client → server messages", () => {
  const fromSpec = new Map(
    rows.flatMap(([names = "", , , limit = ""]) =>
      codeSpans(names).map((t) => [t, parseLimit(limit)] as const),
    ),
  );

  it("covers every client message type", () => {
    expect(Object.keys(RATE_LIMITS).sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
  });

  it.each(CLIENT_MESSAGE_TYPES.map((t) => [t]))("%s", (t) => {
    expect(RATE_LIMITS[t]).toEqual(fromSpec.get(t));
  });
});
