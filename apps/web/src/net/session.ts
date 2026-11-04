/**
 * Presence in a hall (M2): the connection, other visitors, this visitor's position stream, and
 * requests with replies (mats). The scene and HUD talk to this, never to the socket.
 * When the connection is down the temple keeps working alone: requests are answered locally.
 */
import {
  GESTURE_COOLDOWN_MS,
  POS_MAX_HZ,
  POSES,
  roundCm,
  roundYaw,
  type BellId,
  type ClientMessage,
  type EventMessage,
  type Gesture,
  type HallId,
  type Pose,
  type RoomsResponse,
  type ServerMessage,
  type StateTuple,
  type TodayCounters,
  type Visitor,
  type WelcomeMessage,
} from "@sannidhi/protocol";
import type { KeyValueStore } from "../platform/storage";
import { Connection, type NetStatus, type SocketLike, type Timers } from "./connection";
import { Presence } from "./presence";
import { chooseHall, fetchRooms } from "./rooms";

/** A little above 1 / POS_MAX_HZ, so jitter never trips the server's bucket. */
export const POS_GAP_MS = 1000 / POS_MAX_HZ + 5;
/** Lite sends its place at most about 7 times a second, so upstream stays under 0.5 KB/s (spec 10). */
export const LITE_POS_GAP_MS = 1000 / 7 + 5;
/** `sit` and `stand` go at least this far apart: the server allows one of each per second. */
export const MAT_MSG_GAP_MS = 1100;
/** A mat request with no answer by then counts as refused. */
export const SIT_TIMEOUT_MS = 4000;

export interface SessionHandlers {
  /** Joined (or rejoined) a hall. `mine` is the server's state for this visitor. */
  welcome(w: WelcomeMessage, mine: StateTuple | undefined): void;
  status(s: NetStatus): void;
  event(e: EventMessage): void;
  correct(x: number, z: number): void;
  counters(today: TodayCounters): void;
}

/** Sends this visitor's place only when it changes, at most POS_MAX_HZ (spec 04). */
export class PosSender {
  // Plain fields, so the per-frame check allocates nothing (spec 10 § Frame loop hygiene).
  private x = Number.NaN;
  private z = Number.NaN;
  private yaw = Number.NaN;
  private pose: Pose | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  /** What the server already has, e.g. from the welcome; null when unknown. */
  reset(state: { x: number; z: number; yaw: number; pose: Pose } | null): void {
    this.x = state ? roundCm(state.x) : Number.NaN;
    this.z = state ? roundCm(state.z) : Number.NaN;
    this.yaw = state ? roundYaw(state.yaw) : Number.NaN;
    this.pose = state?.pose ?? null;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }

  /** The message to send now, or null. Rounded as the wire wants it. */
  next(now: number, x: number, z: number, yaw: number, pose: Pose, gapMs = POS_GAP_MS) {
    const rx = roundCm(x);
    const rz = roundCm(z);
    const ry = roundYaw(yaw);
    if (rx === this.x && rz === this.z && ry === this.yaw && pose === this.pose) return null;
    if (now - this.lastAt < gapMs) return null;
    this.x = rx;
    this.z = rz;
    this.yaw = ry;
    this.pose = pose;
    this.lastAt = now;
    return { t: "pos" as const, x: rx, z: rz, yaw: ry, pose };
  }
}

export interface SessionOptions {
  base: string;
  wsBase: string;
  store: KeyValueStore;
  lite: () => boolean;
  handlers: SessionHandlers;
  socket?: (url: string) => SocketLike;
  timers?: Timers;
  now?: () => number;
  fetchRooms?: (base: string) => Promise<RoomsResponse | null>;
}

export class Session {
  readonly presence = new Presence();
  readonly conn: Connection;
  you: Visitor | null = null;
  instance: number | null = null;
  today: TodayCounters | null = null;
  rooms: RoomsResponse | null = null;
  private readonly pos = new PosSender();
  private req = 1;
  private readonly pendingSit = new Map<number, (mat: number | null) => void>();
  /** `sit` and `stand` waiting for their turn, MAT_MSG_GAP_MS apart. */
  private readonly matQueue: ClientMessage[] = [];
  private lastMatAt = Number.NEGATIVE_INFINITY;
  private lastGestureAt = Number.NEGATIVE_INFINITY;
  private gestureTimer: number | null = null;
  private matTimer: number | null = null;
  private readonly now: () => number;
  private readonly timers: Timers;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? (() => Date.now());
    this.timers = o.timers ?? {
      set: (fn, ms) => window.setTimeout(fn, ms),
      clear: (id) => window.clearTimeout(id),
    };
    this.conn = new Connection({
      url: o.wsBase,
      store: o.store,
      lite: o.lite,
      ...(o.socket ? { socket: o.socket } : {}),
      ...(o.timers ? { timers: o.timers } : {}),
      ...(o.now ? { now: o.now } : {}),
      onWelcome: (w) => this.welcome(w),
      onMessage: (m) => this.message(m),
      onStatus: (s) => {
        if (s !== "online") this.failPending();
        o.handlers.status(s);
      },
    });
  }

  get online(): boolean {
    return this.conn.online;
  }

  get hall(): HallId | null {
    return this.conn.hall;
  }

  /** Server time (spec 04 § Clock sync). */
  serverNow(): number {
    return this.conn.clock.serverNow();
  }

  /** Picks a hall (the resume hall, else the fullest under 90%) and connects. */
  async start(hall: HallId | null = null): Promise<void> {
    const resumeHall = hall ?? this.conn.resumeHall();
    if (!resumeHall) await this.refreshRooms();
    this.conn.start(chooseHall(this.rooms, resumeHall));
  }

  async refreshRooms(): Promise<RoomsResponse | null> {
    const rooms = await (this.o.fetchRooms ?? fetchRooms)(this.o.base);
    if (rooms) {
      this.rooms = rooms;
      this.today = rooms.today;
    }
    return rooms;
  }

  switchHall(hall: HallId): void {
    this.presence.clear();
    this.you = null;
    this.conn.switchHall(hall);
  }

  /** Called every frame with this visitor's place; sends it when it changed. */
  sendPose(x: number, z: number, yaw: number, pose: Pose): void {
    if (!this.online) return;
    const gap = this.o.lite() ? LITE_POS_GAP_MS : POS_GAP_MS;
    const msg = this.pos.next(this.now(), x, z, yaw, pose, gap);
    if (msg) this.conn.send(msg);
  }

  /** Sends the place now, ahead of anything else (for example before asking for a mat again). */
  sendPoseNow(x: number, z: number, yaw: number, pose: Pose): void {
    this.pos.reset(null);
    this.sendPose(x, z, yaw, pose);
  }

  /** Reconnects with the resume token, for example so a Lite change takes effect (spec 04). */
  reconnect(): void {
    if (!this.online) return;
    this.conn.pause();
    this.conn.wake();
  }

  /**
   * Gestures go at least GESTURE_COOLDOWN_MS (plus a margin) apart, whatever the UI did: a bow is
   * sent only after the avatar has turned, so it could follow a namaste too closely. A gesture
   * that comes too soon waits for its turn; the server would drop it and add a strike.
   */
  gesture(g: Gesture): void {
    const wait = this.lastGestureAt + GESTURE_COOLDOWN_MS + 100 - this.now();
    if (this.gestureTimer !== null) this.timers.clear(this.gestureTimer);
    this.gestureTimer = null;
    if (wait > 0) {
      this.gestureTimer = this.timers.set(() => {
        this.gestureTimer = null;
        this.gesture(g);
      }, wait);
      return;
    }
    if (this.conn.send({ t: "gesture", g })) this.lastGestureAt = this.now();
  }

  bell(bell: BellId): void {
    this.conn.send({ t: "bell", bell });
  }

  /**
   * Asks for a mat, or with none named for the nearest free one (the server knows the mats held
   * for visitors who may resume). Resolves with the mat granted, or null if refused or offline.
   */
  sit(mat?: number): Promise<number | null> {
    if (!this.online) return Promise.resolve(null);
    const req = this.req++;
    return new Promise((resolve) => {
      const timer = this.timers.set(() => this.settleSit(req, null), SIT_TIMEOUT_MS);
      this.pendingSit.set(req, (granted) => {
        this.timers.clear(timer);
        resolve(granted);
      });
      this.queueMat(mat === undefined ? { t: "sit", req } : { t: "sit", req, mat });
    });
  }

  stand(): void {
    if (this.online) this.queueMat({ t: "stand" });
  }

  /** Spaces `sit` and `stand` out, so a quick change of mind never trips the server's limit. */
  private queueMat(msg: ClientMessage): void {
    this.matQueue.push(msg);
    this.drainMat();
  }

  private drainMat(): void {
    if (this.matTimer !== null) return;
    const wait = this.lastMatAt + MAT_MSG_GAP_MS - this.now();
    if (wait > 0) {
      this.matTimer = this.timers.set(() => {
        this.matTimer = null;
        this.drainMat();
      }, wait);
      return;
    }
    const msg = this.matQueue.shift();
    if (!msg) return;
    if (!this.conn.send(msg) && msg.t === "sit") this.settleSit(msg.req, null);
    this.lastMatAt = this.now();
    if (this.matQueue.length > 0) this.drainMat();
  }

  private settleSit(req: number, mat: number | null): void {
    const done = this.pendingSit.get(req);
    this.pendingSit.delete(req);
    done?.(mat);
  }

  pause(): void {
    this.conn.pause();
  }

  wake(): void {
    this.conn.wake();
  }

  /** The network may be back, or the tab is visible again (spec 04 § Reconnect back-off). */
  reconnectNow(): void {
    this.conn.reconnectNow();
  }

  dispose(): void {
    this.failPending();
    this.conn.dispose();
  }

  private welcome(w: WelcomeMessage): void {
    this.you = w.you;
    this.instance = w.instance;
    this.today = w.snapshot.today;
    const mine = this.presence.applyWelcome(w);
    this.pos.reset(
      mine ? { x: mine[1], z: mine[2], yaw: mine[3], pose: POSES[mine[4]] ?? "stand" } : null,
    );
    this.o.handlers.welcome(w, mine);
  }

  private message(m: ServerMessage): void {
    const h = this.o.handlers;
    switch (m.t) {
      case "delta":
        this.presence.applyDelta(m);
        return;
      case "event":
        h.event(m);
        return;
      case "correct":
        // The server keeps the last valid place; send from there next time.
        this.pos.reset(null);
        h.correct(m.x, m.z);
        return;
      case "sit.ok":
      case "sit.no":
        this.settleSit(m.req, m.t === "sit.ok" ? m.mat : null);
        return;
      case "counters":
        this.today = m.today;
        h.counters(m.today);
        return;
      default:
        // Rituals of later milestones.
        return;
    }
  }

  /** Requests in flight when the socket goes away are answered as refused; queued ones are dropped. */
  private failPending(): void {
    const pending = [...this.pendingSit.values()];
    this.pendingSit.clear();
    this.matQueue.length = 0;
    if (this.matTimer !== null) this.timers.clear(this.matTimer);
    this.matTimer = null;
    for (const done of pending) done(null);
  }
}
