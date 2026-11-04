/**
 * Message shapes from specs/04-realtime-protocol.md. Text frames carry JSON objects
 * with a `t` field; the literal frames "ping" / "pong" are the heartbeat and are not JSON.
 */
import { HALL_COUNT, type PROTOCOL_VERSION } from "./constants";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** "hall-01" … "hall-20". Validate with `isHallId`. */
export type HallId = `hall-${string}`;

export const HALL_IDS: readonly HallId[] = Array.from(
  { length: HALL_COUNT },
  (_, i): HallId => `hall-${String(i + 1).padStart(2, "0")}`,
);

/** Short id, unique within one instance, for example "k3". */
export type VisitorId = string;

/**
 * The array index is the `poseIndex` in `StateTuple`, so this order is part of the wire format:
 * append only. Reordering or removing a pose is a breaking change (bump PROTOCOL_VERSION).
 */
export const POSES = ["stand", "walk", "sit", "pranam", "japa", "offer"] as const;
export type Pose = (typeof POSES)[number];

export const BELL_IDS = [
  "gate",
  "path-1",
  "path-2",
  "path-3",
  "path-4",
  "path-5",
  "path-6",
  "path-7",
  "path-8",
  "mandapa-n",
  "mandapa-s",
] as const;
export type BellId = (typeof BELL_IDS)[number];

export const GESTURES = ["namaste", "pranam", "aarti", "prasad"] as const;
export type Gesture = (typeof GESTURES)[number];

export const JAL_KINDS = ["water", "bilva"] as const;
export type JalKind = (typeof JAL_KINDS)[number];

export const EVENT_KINDS = [
  "namaste",
  "pranam",
  "bell",
  "jal",
  "bilva",
  "aarti",
  "prasad",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Profile, sent once on join. */
export interface Visitor {
  id: VisitorId;
  /** Key into the curated name list (spec 05) plus a number, e.g. { key: "deodar", n: 214 }. */
  name: { key: string; n: number };
  /** 0..7 palette index. */
  shawl: number;
  body: 0 | 1;
  joinedAt: number;
}

/**
 * Compact per-visitor state for snapshots and deltas:
 * [id, x, z, yaw, poseIndex, mat]. `mat` is the mat the visitor holds (walking to it or
 * seated), -1 when none.
 * Positions are rounded to 0.01 m and yaw to 0.01 rad by the sender.
 */
export type StateTuple = [
  id: VisitorId,
  x: number,
  z: number,
  yaw: number,
  poseIndex: number,
  mat: number,
];

export interface Lamp {
  slot: number;
  litAt: number;
  expiresAt: number;
  mine?: true;
}

export interface TodayCounters {
  /** IST date, "YYYY-MM-DD". */
  date: string;
  diyas: number;
  malas: number;
  parikramas: number;
  visits: number;
}

export interface Snapshot {
  rev: number;
  visitors: Visitor[];
  states: StateTuple[];
  lamps: Lamp[];
  /** Queue lengths only. */
  queues: { diya: number; jal: number };
  today: TodayCounters;
}

// ---------------------------------------------------------------------------
// GET /api/rooms
// ---------------------------------------------------------------------------

export interface HallSummary {
  id: HallId;
  number: number;
  /** Visitors across instances. */
  count: number;
  /** INSTANCE_CAPACITY * INSTANCES_PER_HALL. */
  capacity: number;
  /** Instances currently open. */
  instances: number;
  /** When the count was last reported, ms since epoch. */
  checkedAt: number;
}

export interface RoomsResponse {
  v: typeof PROTOCOL_VERSION;
  /** ms since epoch. */
  serverTime: number;
  halls: HallSummary[];
  today: TodayCounters;
}

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

export interface PosMessage {
  t: "pos";
  x: number;
  z: number;
  yaw: number;
  pose: Pose;
}
export interface GestureMessage {
  t: "gesture";
  g: Gesture;
}
export interface BellMessage {
  t: "bell";
  bell: BellId;
}
export interface SitMessage {
  t: "sit";
  req: number;
  /** Omitted: the server picks the nearest free mat. */
  mat?: number;
}
export interface StandMessage {
  t: "stand";
}
export interface DiyaRequestMessage {
  t: "diya.request";
  req: number;
}
export interface DiyaLightMessage {
  t: "diya.light";
  req: number;
}
export interface DiyaCancelMessage {
  t: "diya.cancel";
}
export interface JalRequestMessage {
  t: "jal.request";
  req: number;
  kind: JalKind;
}
export interface JalDoneMessage {
  t: "jal.done";
  req: number;
}
export interface JalCancelMessage {
  t: "jal.cancel";
}
export interface JapaMalaMessage {
  t: "japa.mala";
}
export interface TimeRequestMessage {
  t: "time";
  /** Client ms. */
  c: number;
}
export interface LeaveMessage {
  t: "leave";
}

export type ClientMessage =
  | PosMessage
  | GestureMessage
  | BellMessage
  | SitMessage
  | StandMessage
  | DiyaRequestMessage
  | DiyaLightMessage
  | DiyaCancelMessage
  | JalRequestMessage
  | JalDoneMessage
  | JalCancelMessage
  | JapaMalaMessage
  | TimeRequestMessage
  | LeaveMessage;

export type ClientMessageType = ClientMessage["t"];

export const CLIENT_MESSAGE_TYPES = [
  "pos",
  "gesture",
  "bell",
  "sit",
  "stand",
  "diya.request",
  "diya.light",
  "diya.cancel",
  "jal.request",
  "jal.done",
  "jal.cancel",
  "japa.mala",
  "time",
  "leave",
] as const satisfies readonly ClientMessageType[];

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

export interface WelcomeMessage {
  t: "welcome";
  v: typeof PROTOCOL_VERSION;
  you: Visitor;
  hall: HallId;
  /** 1 … INSTANCES_PER_HALL. */
  instance: number;
  /** Resume token, "<hall>.<instance>.<random>" (spec 05). */
  resume: string;
  serverTime: number;
  snapshot: Snapshot;
}
export interface DeltaMessage {
  t: "delta";
  rev: number;
  at: number;
  join?: Visitor[];
  up?: StateTuple[];
  gone?: VisitorId[];
}
export interface EventMessage {
  t: "event";
  from: VisitorId;
  kind: EventKind;
  bell?: BellId;
}
export interface CorrectMessage {
  t: "correct";
  x: number;
  z: number;
}
export interface SitOkMessage {
  t: "sit.ok";
  req: number;
  mat: number;
}
export interface SitNoMessage {
  t: "sit.no";
  req: number;
}
export interface DiyaQueueMessage {
  t: "diya.queue";
  /** Place in the queue, 0 = next. */
  pos: number;
}
export interface DiyaTurnMessage {
  t: "diya.turn";
  req: number;
  spot: number;
  until: number;
}
export interface DiyaLitMessage {
  t: "diya.lit";
  lamp: Lamp;
  by?: VisitorId;
}
export interface DiyaOutMessage {
  t: "diya.out";
  slot: number;
}
export const DIYA_REFUSALS = ["has-lamp", "stand-full", "busy", "not-near"] as const;
export type DiyaRefusal = (typeof DIYA_REFUSALS)[number];
export interface DiyaNoMessage {
  t: "diya.no";
  req: number;
  why: DiyaRefusal;
  nextFreeAt?: number;
}
export interface JalQueueMessage {
  t: "jal.queue";
  pos: number;
}
export interface JalTurnMessage {
  t: "jal.turn";
  req: number;
  until: number;
}
export const JAL_REFUSALS = ["cooldown", "busy", "not-near"] as const;
export type JalRefusal = (typeof JAL_REFUSALS)[number];
export interface JalNoMessage {
  t: "jal.no";
  req: number;
  why: JalRefusal;
}
export interface PradakshinaDoneMessage {
  t: "pradakshina.done";
  n: number;
}
export interface CountersMessage {
  t: "counters";
  today: TodayCounters;
}
export interface TimeReplyMessage {
  t: "time";
  /** Echo of the client's ms. */
  c: number;
  /** Server ms. */
  s: number;
}
export const ERROR_CODES = ["rate_limited", "bad_message"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ErrorMessage {
  t: "error";
  code: ErrorCode;
  msg?: string;
}

export type ServerMessage =
  | WelcomeMessage
  | DeltaMessage
  | EventMessage
  | CorrectMessage
  | SitOkMessage
  | SitNoMessage
  | DiyaQueueMessage
  | DiyaTurnMessage
  | DiyaLitMessage
  | DiyaOutMessage
  | DiyaNoMessage
  | JalQueueMessage
  | JalTurnMessage
  | JalNoMessage
  | PradakshinaDoneMessage
  | CountersMessage
  | TimeReplyMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage["t"];

export const SERVER_MESSAGE_TYPES = [
  "welcome",
  "delta",
  "event",
  "correct",
  "sit.ok",
  "sit.no",
  "diya.queue",
  "diya.turn",
  "diya.lit",
  "diya.out",
  "diya.no",
  "jal.queue",
  "jal.turn",
  "jal.no",
  "pradakshina.done",
  "counters",
  "time",
  "error",
] as const satisfies readonly ServerMessageType[];

/** Heartbeat text frames (spec 04 § Connection lifecycle). Not JSON. */
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";
