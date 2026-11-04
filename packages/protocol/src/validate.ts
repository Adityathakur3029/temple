/**
 * Type guards for inbound messages. No dependencies, never throws.
 * The server runs every client frame through `decodeClientMessage` (spec 05 § Handling a message).
 */
import { MAT_COUNT, MAX_CLIENT_MESSAGE_BYTES } from "./constants";
import {
  BELL_IDS,
  GESTURES,
  HALL_IDS,
  JAL_KINDS,
  POSES,
  type ClientMessage,
  type ClientMessageType,
  type HallId,
} from "./messages";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isOneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** `req` is a client-chosen non-negative integer, echoed in the reply. */
function isReq(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

function isMatIndex(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAT_COUNT;
}

/** Rejects any key outside `keys`, so a message can't smuggle extra data. */
function hasOnly(o: Obj, keys: readonly string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k));
}

const bare = (o: Obj): boolean => hasOnly(o, ["t"]);
const withReq = (o: Obj): boolean => hasOnly(o, ["t", "req"]) && isReq(o.req);

// Position ranges are checked against the walkable area by the server's movement rule
// (spec 05), using world.ts. Here we only require finite numbers.
const VALIDATORS: { readonly [K in ClientMessageType]: (o: Obj) => boolean } = {
  pos: (o) =>
    hasOnly(o, ["t", "x", "z", "yaw", "pose"]) &&
    isFiniteNumber(o.x) &&
    isFiniteNumber(o.z) &&
    isFiniteNumber(o.yaw) &&
    isOneOf(o.pose, POSES),
  gesture: (o) => hasOnly(o, ["t", "g"]) && isOneOf(o.g, GESTURES),
  bell: (o) => hasOnly(o, ["t", "bell"]) && isOneOf(o.bell, BELL_IDS),
  sit: (o) =>
    hasOnly(o, ["t", "req", "mat"]) && isReq(o.req) && (o.mat === undefined || isMatIndex(o.mat)),
  stand: bare,
  "diya.request": withReq,
  "diya.light": withReq,
  "diya.cancel": bare,
  "jal.request": (o) =>
    hasOnly(o, ["t", "req", "kind"]) && isReq(o.req) && isOneOf(o.kind, JAL_KINDS),
  "jal.done": withReq,
  "jal.cancel": bare,
  "japa.mala": bare,
  time: (o) => hasOnly(o, ["t", "c"]) && isFiniteNumber(o.c) && o.c >= 0,
  leave: bare,
};

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObj(value)) return false;
  const t = value.t;
  if (typeof t !== "string" || !Object.hasOwn(VALIDATORS, t)) return false;
  return VALIDATORS[t as ClientMessageType](value);
}

export function isHallId(value: unknown): value is HallId {
  return isOneOf(value, HALL_IDS);
}

/** UTF-8 byte length without TextEncoder, so this package stays free of DOM/Node types. */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** True when a frame is over MAX_CLIENT_MESSAGE_BYTES. Each UTF-16 unit is at least one byte, so long strings fail fast. */
export function isOversized(frame: string): boolean {
  return (
    frame.length > MAX_CLIENT_MESSAGE_BYTES || utf8ByteLength(frame) > MAX_CLIENT_MESSAGE_BYTES
  );
}

export type DecodeResult =
  { ok: true; msg: ClientMessage } | { ok: false; reason: "too_large" | "bad_json" | "invalid" };

/** Steps 1–3 of spec 05 § Handling a message: size, JSON.parse, type guard. Every failure is a strike. */
export function decodeClientMessage(frame: string): DecodeResult {
  if (isOversized(frame)) return { ok: false, reason: "too_large" };
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  return isClientMessage(value) ? { ok: true, msg: value } : { ok: false, reason: "invalid" };
}
