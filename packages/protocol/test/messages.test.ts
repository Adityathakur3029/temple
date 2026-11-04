import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BELL_IDS,
  CLIENT_MESSAGE_TYPES,
  DIYA_REFUSALS,
  ERROR_CODES,
  EVENT_KINDS,
  GESTURES,
  JAL_KINDS,
  JAL_REFUSALS,
  POSES,
  SERVER_MESSAGE_TYPES,
  type ClientMessageType,
  type ServerMessageType,
} from "../src/index";
import { codeSpans, quoted, readSpec, section, tableRows } from "./spec";

const spec = readSpec("04-realtime-protocol.md");
const clientRows = tableRows(section(spec, "Client → server messages"));
const serverRows = tableRows(section(spec, "Server → client messages"));

function serverRow(t: string): string[] {
  const row = serverRows.find(([names = ""]) => codeSpans(names).includes(t));
  if (!row) throw new Error(`No server row for ${t}`);
  return row;
}

describe("message types match spec 04", () => {
  it("client → server", () => {
    const fromSpec = clientRows.flatMap(([names = ""]) => codeSpans(names));
    expect([...CLIENT_MESSAGE_TYPES].sort()).toEqual([...fromSpec].sort());
  });

  it("server → client", () => {
    const fromSpec = serverRows.flatMap(([names = ""]) => codeSpans(names));
    expect([...SERVER_MESSAGE_TYPES].sort()).toEqual([...new Set(fromSpec)].sort());
  });

  it("type lists cover every union member", () => {
    expectTypeOf<(typeof CLIENT_MESSAGE_TYPES)[number]>().toEqualTypeOf<ClientMessageType>();
    expectTypeOf<(typeof SERVER_MESSAGE_TYPES)[number]>().toEqualTypeOf<ServerMessageType>();
  });
});

describe("enumerations match spec 04", () => {
  const shared = section(spec, "Shared types");

  it("POSES, in index order", () => {
    const line = shared.split("\n").find((l) => l.startsWith("const POSES"));
    expect(line).toBeDefined();
    expect([...POSES]).toEqual(quoted(line ?? ""));
  });

  it("GESTURES", () => {
    const line = shared.split("\n").find((l) => l.startsWith("type Gesture"));
    expect([...GESTURES]).toEqual(quoted(line ?? ""));
  });

  it("BELL_IDS", () => {
    const line = shared.split("\n").find((l) => l.startsWith("type BellId")) ?? "";
    expect(line).toContain("path-${1|2|3|4|5|6|7|8}");
    const paths = Array.from({ length: 8 }, (_, i) => `path-${i + 1}`);
    expect([...BELL_IDS].sort()).toEqual([...quoted(line), ...paths].sort());
  });

  it("JAL_KINDS", () => {
    const row = clientRows.find(([names = ""]) => codeSpans(names).includes("jal.request"));
    expect([...JAL_KINDS]).toEqual(quoted(row?.[1] ?? ""));
  });

  it("EVENT_KINDS", () => {
    expect([...EVENT_KINDS]).toEqual(quoted(serverRow("event")[1] ?? ""));
  });

  it("DIYA_REFUSALS", () => {
    expect([...DIYA_REFUSALS]).toEqual(quoted(serverRow("diya.no")[1] ?? ""));
  });

  it("JAL_REFUSALS", () => {
    expect([...JAL_REFUSALS]).toEqual(quoted(serverRow("jal.no")[1] ?? ""));
  });

  it("ERROR_CODES", () => {
    expect([...ERROR_CODES]).toEqual(quoted(serverRow("error")[1] ?? ""));
  });
});
