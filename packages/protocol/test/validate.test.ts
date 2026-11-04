import { describe, expect, it } from "vitest";
import {
  CLIENT_MESSAGE_TYPES,
  MAT_COUNT,
  MAX_CLIENT_MESSAGE_BYTES,
  decodeClientMessage,
  isClientMessage,
  isHallId,
  isOversized,
  utf8ByteLength,
  type ClientMessage,
} from "../src/index";

const VALID: ClientMessage[] = [
  { t: "pos", x: 1.23, z: -45.6, yaw: 3.14, pose: "walk" },
  { t: "pos", x: 0, z: 58, yaw: -1.57, pose: "sit" },
  { t: "gesture", g: "namaste" },
  { t: "gesture", g: "prasad" },
  { t: "bell", bell: "gate" },
  { t: "bell", bell: "path-8" },
  { t: "bell", bell: "mandapa-s" },
  { t: "sit", req: 1 },
  { t: "sit", req: 2, mat: 0 },
  { t: "sit", req: 3, mat: MAT_COUNT - 1 },
  { t: "stand" },
  { t: "diya.request", req: 0 },
  { t: "diya.light", req: 7 },
  { t: "diya.cancel" },
  { t: "jal.request", req: 4, kind: "water" },
  { t: "jal.request", req: 5, kind: "bilva" },
  { t: "jal.done", req: 5 },
  { t: "jal.cancel" },
  { t: "japa.mala" },
  { t: "time", c: 1_762_160_000_000 },
  { t: "leave" },
];

const INVALID: [string, unknown][] = [
  ["null", null],
  ["number", 3],
  ["string", "leave"],
  ["array", [{ t: "leave" }]],
  ["no t", {}],
  ["unknown t", { t: "dance" }],
  ["inherited t name", { t: "toString" }],
  ["t not a string", { t: 1 }],
  ["extra field", { t: "leave", note: "hi" }],
  ["__proto__ key", JSON.parse('{"t":"stand","__proto__":{"x":1}}')],
  ["pos missing yaw", { t: "pos", x: 1, z: 2, pose: "walk" }],
  ["pos NaN", { t: "pos", x: Number.NaN, z: 2, yaw: 0, pose: "walk" }],
  ["pos Infinity", { t: "pos", x: 1, z: Number.POSITIVE_INFINITY, yaw: 0, pose: "walk" }],
  ["pos string number", { t: "pos", x: "1", z: 2, yaw: 0, pose: "walk" }],
  ["pos pose index", { t: "pos", x: 1, z: 2, yaw: 0, pose: 1 }],
  ["pos unknown pose", { t: "pos", x: 1, z: 2, yaw: 0, pose: "run" }],
  ["gesture unknown", { t: "gesture", g: "wave" }],
  ["bell unknown", { t: "bell", bell: "path-9" }],
  ["sit no req", { t: "sit" }],
  ["sit negative req", { t: "sit", req: -1 }],
  ["sit fractional req", { t: "sit", req: 1.5 }],
  ["sit mat too high", { t: "sit", req: 1, mat: MAT_COUNT }],
  ["sit mat negative", { t: "sit", req: 1, mat: -1 }],
  ["sit mat null", { t: "sit", req: 1, mat: null }],
  ["sit fractional mat", { t: "sit", req: 1, mat: 1.5 }],
  ["diya.request unsafe req", { t: "diya.request", req: 2 ** 53 }],
  ["jal.request no kind", { t: "jal.request", req: 1 }],
  ["jal.request bad kind", { t: "jal.request", req: 1, kind: "milk" }],
  ["time negative", { t: "time", c: -5 }],
  ["time string", { t: "time", c: "now" }],
];

/** Values that are invalid for every field of every message. */
const JUNK: unknown[] = [null, {}, [], "", "zzz", true, Number.NaN, Number.POSITIVE_INFINITY];

describe("isClientMessage", () => {
  it("has a valid example for every client message type", () => {
    expect(new Set(VALID.map((m) => m.t))).toEqual(new Set(CLIENT_MESSAGE_TYPES));
  });

  it.each(VALID.map((m) => [m.t, m] as const))("accepts %s", (_, msg) => {
    expect(isClientMessage(msg)).toBe(true);
    expect(isClientMessage(JSON.parse(JSON.stringify(msg)))).toBe(true);
  });

  it.each(INVALID)("rejects %s", (_, value) => {
    expect(isClientMessage(value)).toBe(false);
  });

  it("rejects every valid message with an extra field", () => {
    for (const msg of VALID) {
      expect(isClientMessage({ ...msg, extra: 1 }), msg.t).toBe(false);
    }
  });

  it("rejects every valid message with any one field replaced by junk", () => {
    for (const msg of VALID) {
      for (const key of Object.keys(msg)) {
        for (const junk of JUNK) {
          const mutated = { ...msg, [key]: junk };
          expect(isClientMessage(mutated), `${msg.t}.${key} = ${String(junk)}`).toBe(false);
        }
      }
    }
  });
});

/** Small deterministic PRNG (mulberry32) so fuzz failures can be reproduced. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomJson(r: () => number, depth = 0): unknown {
  const pick = Math.floor(r() * (depth > 2 ? 5 : 7));
  const keys = ["t", "x", "z", "yaw", "pose", "req", "mat", "kind", "g", "bell", "c", "__proto__"];
  const strings = [...CLIENT_MESSAGE_TYPES, "walk", "gate", "water", "namaste", "", "ॐ"];
  switch (pick) {
    case 0:
      return null;
    case 1:
      return r() < 0.5;
    case 2:
      return (r() - 0.5) * 10 ** Math.floor(r() * 20);
    case 3:
      return strings[Math.floor(r() * strings.length)];
    case 4:
      return Math.floor(r() * 100);
    case 5:
      return Array.from({ length: Math.floor(r() * 4) }, () => randomJson(r, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      const n = Math.floor(r() * 6);
      for (let i = 0; i < n; i++)
        o[keys[Math.floor(r() * keys.length)] ?? "t"] = randomJson(r, depth + 1);
      return o;
    }
  }
}

describe("decodeClientMessage", () => {
  it("decodes a valid frame", () => {
    expect(decodeClientMessage('{"t":"bell","bell":"gate"}')).toEqual({
      ok: true,
      msg: { t: "bell", bell: "gate" },
    });
  });

  it("rejects bad JSON", () => {
    for (const frame of ["", "{", "ping", "{t:'leave'}", "undefined", "\u0000"]) {
      expect(decodeClientMessage(frame)).toEqual({ ok: false, reason: "bad_json" });
    }
  });

  it("enforces MAX_CLIENT_MESSAGE_BYTES in UTF-8 bytes", () => {
    const base = '{"t":"leave"}';
    const exact = base + " ".repeat(MAX_CLIENT_MESSAGE_BYTES - base.length);
    expect(decodeClientMessage(exact).ok).toBe(true);
    expect(decodeClientMessage(exact + " ")).toEqual({ ok: false, reason: "too_large" });
    // 400 Devanagari characters are 1,200 bytes but only 400 UTF-16 units.
    expect(isOversized("ॐ".repeat(400))).toBe(true);
    expect(isOversized("x".repeat(10_000_000))).toBe(true);
  });

  it("never throws on fuzzed JSON and accepts only valid messages", () => {
    const r = rng(20261103);
    for (let i = 0; i < 20_000; i++) {
      const value = randomJson(r);
      const frame = JSON.stringify(value) ?? "null";
      const result = decodeClientMessage(frame);
      if (result.ok) expect(isClientMessage(result.msg)).toBe(true);
    }
  });

  it("never throws on random text", () => {
    const r = rng(7);
    for (let i = 0; i < 5_000; i++) {
      const s = Array.from({ length: Math.floor(r() * 64) }, () =>
        String.fromCharCode(Math.floor(r() * 0xffff)),
      ).join("");
      expect(() => decodeClientMessage(s)).not.toThrow();
    }
  });
});

describe("utf8ByteLength", () => {
  it("matches Buffer.byteLength, including surrogate pairs and lone surrogates", () => {
    const samples = ["", "a", "é", "ॐ नमः शिवाय", "🪔", "a🪔b", "\ud800", "\udc00x", "x\ud83d"];
    for (const s of samples)
      expect(utf8ByteLength(s), JSON.stringify(s)).toBe(Buffer.byteLength(s));
  });
});

describe("isHallId", () => {
  it("accepts hall-01 … hall-20 only", () => {
    expect(isHallId("hall-01")).toBe(true);
    expect(isHallId("hall-20")).toBe(true);
    for (const bad of ["hall-1", "hall-00", "hall-21", "HALL-01", "", null, 1]) {
      expect(isHallId(bad)).toBe(false);
    }
  });
});
