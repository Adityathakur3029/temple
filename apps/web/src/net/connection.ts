/**
 * The WebSocket to the realtime Worker (spec 04 § Connection lifecycle): resume tokens, the
 * heartbeat, clock-sync samples, reconnect back-off and every close code.
 * The socket, timers, clock and randomness are injectable so tests can drive it.
 */
import {
  CLOSE_CODES,
  HEARTBEAT_MS,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
  RECONNECT_JITTER_MS,
  RECONNECT_MAX_MS,
  RESUME_WINDOW_MS,
  decodeServerMessage,
  isHallId,
  type ClientMessage,
  type HallId,
  type ServerMessage,
  type WelcomeMessage,
} from "@sannidhi/protocol";
import { type KeyValueStore, isRecord, parseJson } from "../platform/storage";
import { ClockSync } from "./clock";

/** sessionStorage key for the resume token (spec 04 § Connection lifecycle, spec 09). */
export const RESUME_KEY = "sannidhi:resume-v1";
/** Back-off resets after this long connected. */
export const STABLE_MS = 30_000;
/** After 4008, wait this long before trying again. */
export const STRIKE_WAIT_MS = 60_000;
/** Clock samples: three, 500 ms apart, after each welcome and every 5 minutes. */
export const SAMPLE_COUNT = 3;
export const SAMPLE_GAP_MS = 500;
export const RESAMPLE_MS = 300_000;
const HEARTBEAT_CHECK_MS = 5000;
/**
 * A ping with nothing back for this long means the socket is dead though the browser hasn't
 * noticed (a half-open connection): close it and resume (spec 04 § Heartbeat).
 */
export const PONG_TIMEOUT_MS = 10_000;

export type NetStatus =
  /** Opening the first socket. */
  | "connecting"
  | "online"
  /** The socket dropped; trying again with back-off. */
  | "reconnecting"
  /** Closed on purpose (rest, another tab, a hidden tab). `wake()` reconnects. */
  | "paused"
  /** The server closed a silent socket (4011). Reconnects on visitor activity. */
  | "idle"
  /** Too many strikes (4008). Tries again after a minute. */
  | "waiting"
  /** Every instance of the hall is full (4004). The visitor picks another hall. */
  | "hall-full"
  /** A new version is deployed (4002). */
  | "refresh"
  /** The origin is not allowed (4003). */
  | "error";

/** The parts of WebSocket this uses. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
}

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface ConnectionOptions {
  /** ws(s)://host of the realtime Worker. */
  url: string;
  store: KeyValueStore;
  lite: () => boolean;
  onWelcome: (w: WelcomeMessage) => void;
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: NetStatus) => void;
  socket?: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  timers?: Timers;
}

interface StoredResume {
  token: string;
  hall: HallId;
  /** When the socket closed; null while connected (or if the page went away mid-session). */
  closedAt: number | null;
  /** Last seen connected, refreshed during the session, for a page that died without pagehide. */
  seenAt?: number;
}

/** min(RECONNECT_MAX_MS, RECONNECT_BASE_MS × 2^attempt) + random(0, RECONNECT_JITTER_MS). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  return (
    Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt) + random() * RECONNECT_JITTER_MS
  );
}

export function readResume(store: KeyValueStore): StoredResume | null {
  const v = parseJson(store.getItem(RESUME_KEY));
  if (!isRecord(v) || typeof v.token !== "string" || !isHallId(v.hall)) return null;
  const closedAt = typeof v.closedAt === "number" ? v.closedAt : null;
  return {
    token: v.token,
    hall: v.hall,
    closedAt,
    ...(typeof v.seenAt === "number" ? { seenAt: v.seenAt } : {}),
  };
}

const defaultTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

export class Connection {
  readonly clock: ClockSync;
  private ws: SocketLike | null = null;
  private hallId: HallId | null = null;
  private state: NetStatus = "connecting";
  private attempt = 0;
  private lastSent = 0;
  private lastReceived = 0;
  /** When the ping we are waiting on went out, or null. */
  private pingAt: number | null = null;
  private retry: number | null = null;
  /** A back-off wait may be cut short once, by the `online` event or the tab becoming visible. */
  private cutShort = false;
  private stable: number | null = null;
  private resample: number | null = null;
  private heartbeat: number | null = null;
  private samples: number[] = [];
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly socket: (url: string) => SocketLike;

  constructor(private readonly o: ConnectionOptions) {
    this.now = o.now ?? (() => Date.now());
    this.timers = o.timers ?? defaultTimers;
    this.socket = o.socket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.clock = new ClockSync(this.now);
  }

  get status(): NetStatus {
    return this.state;
  }

  get hall(): HallId | null {
    return this.hallId;
  }

  get online(): boolean {
    return this.state === "online";
  }

  /** The hall a stored, still-fresh resume token belongs to. */
  resumeHall(): HallId | null {
    const r = readResume(this.o.store);
    return r && this.fresh(r) ? r.hall : null;
  }

  start(hall: HallId): void {
    this.hallId = hall;
    this.attempt = 0;
    this.open();
  }

  /** Leave this hall on purpose and join another (spec 04 § Leave). */
  switchHall(hall: HallId): void {
    this.leave();
    this.start(hall);
  }

  /** Sends a message if connected. Returns false when it couldn't be sent. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || this.state !== "online") return false;
    try {
      this.ws.send(JSON.stringify(msg));
      this.lastSent = this.now();
      return true;
    } catch {
      return false;
    }
  }

  /** Close for now and keep the resume token: rest, another tab, a hidden tab (spec 10). */
  pause(): void {
    if (!this.hallId || this.state === "paused") return;
    this.cancelRetry();
    this.closeSocket(CLOSE_CODES.NORMAL, "pause");
    this.setStatus("paused");
  }

  /**
   * The visitor is here again (activity after rest or a 4011, or the tab owns rendering again):
   * reconnect a paused or idle socket. Never cuts a back-off wait short (spec 04).
   */
  wake(): void {
    if (!this.hallId) return;
    if (this.state === "paused" || this.state === "idle") this.open();
  }

  /**
   * The network may be back (the `online` event) or the tab became visible: cut a back-off wait
   * short, once per wait, and check that an open socket still answers (spec 04 § Reconnect).
   * A 4008 wait is never cut short.
   */
  reconnectNow(): void {
    if (!this.hallId) return;
    if (this.state === "reconnecting" && !this.ws && this.retry !== null && !this.cutShort) {
      this.cutShort = true;
      this.open();
    } else if (this.state === "online") {
      this.probe();
    }
  }

  /** Leave on purpose: frees the mat and queue places at once. */
  leave(): void {
    this.cancelRetry();
    if (this.ws && this.state === "online") this.send({ t: "leave" });
    this.closeSocket(CLOSE_CODES.NORMAL, "leave");
    this.o.store.setItem(RESUME_KEY, "");
    this.setStatus("paused");
  }

  /** The page is going away: start the resume window now, as the server does. */
  noteUnload(): void {
    this.markClosed();
  }

  dispose(): void {
    this.cancelRetry();
    this.closeSocket(CLOSE_CODES.NORMAL, "dispose");
  }

  // -------------------------------------------------------------------------------------------

  private fresh(r: StoredResume): boolean {
    const since = r.closedAt ?? r.seenAt;
    return since === undefined || this.now() - since < RESUME_WINDOW_MS;
  }

  /** Sends a ping; no frame back within PONG_TIMEOUT_MS means the socket is dead. */
  private probe(): void {
    if (!this.ws || this.pingAt !== null) return;
    try {
      this.ws.send(HEARTBEAT_PING);
      this.lastSent = this.pingAt = this.now();
    } catch {
      // The close handler takes over.
    }
  }

  private open(): void {
    const hall = this.hallId;
    if (!hall) return;
    this.cancelRetry();
    this.closeSocket(CLOSE_CODES.NORMAL, "reopen");
    const stored = readResume(this.o.store);
    const token = stored && stored.hall === hall && this.fresh(stored) ? stored.token : null;
    let url = `${this.o.url}/ws?hall=${hall}&v=${PROTOCOL_VERSION}`;
    if (token) url += `&resume=${encodeURIComponent(token)}`;
    if (this.o.lite()) url += "&lite=1";
    if (this.state !== "connecting") this.setStatus("reconnecting");

    let ws: SocketLike;
    try {
      ws = this.socket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => {
      if (this.ws === ws) this.receive(e.data);
    };
    ws.onclose = (e) => {
      if (this.ws === ws) this.closed(e.code);
    };
  }

  private receive(data: unknown): void {
    this.lastReceived = this.now();
    this.pingAt = null;
    if (typeof data !== "string" || data === HEARTBEAT_PONG) return;
    const msg = decodeServerMessage(data);
    if (!msg) return;
    if (msg.t === "welcome") {
      this.o.store.setItem(
        RESUME_KEY,
        JSON.stringify({
          token: msg.resume,
          hall: msg.hall,
          closedAt: null,
          seenAt: this.now(),
        } satisfies StoredResume),
      );
      this.clock.seed(msg.serverTime);
      this.lastSent = this.now();
      this.setStatus("online");
      this.stable = this.timers.set(() => (this.attempt = 0), STABLE_MS);
      this.sampleClock();
      this.resample = this.timers.set(() => this.resampleLoop(), RESAMPLE_MS);
      this.heartbeat = this.timers.set(() => this.beat(), HEARTBEAT_CHECK_MS);
      this.o.onWelcome(msg);
      return;
    }
    if (msg.t === "time") this.clock.add(msg.c, msg.s);
    this.o.onMessage(msg);
  }

  private sampleClock(): void {
    for (const id of this.samples) this.timers.clear(id);
    this.samples = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      this.samples.push(
        this.timers.set(() => this.send({ t: "time", c: this.now() }), i * SAMPLE_GAP_MS),
      );
    }
  }

  private resampleLoop(): void {
    this.sampleClock();
    this.resample = this.timers.set(() => this.resampleLoop(), RESAMPLE_MS);
  }

  /**
   * Text `ping` after HEARTBEAT_MS without sending anything, and a dead-socket check: a ping
   * unanswered for PONG_TIMEOUT_MS closes the socket and resumes (spec 04 § Heartbeat).
   */
  private beat(): void {
    const now = this.now();
    if (this.ws && this.state === "online") {
      if (this.pingAt !== null && now - this.pingAt >= PONG_TIMEOUT_MS) {
        this.closeSocket(CLOSE_CODES.NORMAL, "no answer");
        this.scheduleRetry();
        return;
      }
      if (now - this.lastSent >= HEARTBEAT_MS) this.probe();
      const r = readResume(this.o.store);
      if (r && r.closedAt === null) {
        this.o.store.setItem(RESUME_KEY, JSON.stringify({ ...r, seenAt: now }));
      }
    }
    this.heartbeat = this.timers.set(() => this.beat(), HEARTBEAT_CHECK_MS);
  }

  private closed(code: number): void {
    this.ws = null;
    this.stopSessionTimers();
    this.markClosed();
    switch (code) {
      case CLOSE_CODES.INSTANCE_FULL:
        // The server picks another instance. A little jitter, so a crowd doesn't retry at once.
        this.retry = this.timers.set(
          () => this.open(),
          (this.o.random ?? Math.random)() * RECONNECT_JITTER_MS,
        );
        this.setStatus("reconnecting");
        return;
      case CLOSE_CODES.VERSION_MISMATCH:
        this.setStatus("refresh");
        return;
      case CLOSE_CODES.ORIGIN_NOT_ALLOWED:
        this.setStatus("error");
        return;
      case CLOSE_CODES.HALL_FULL:
        this.setStatus("hall-full");
        return;
      case CLOSE_CODES.TOO_MANY_STRIKES:
        this.o.store.setItem(RESUME_KEY, "");
        this.setStatus("waiting");
        this.retry = this.timers.set(() => this.open(), STRIKE_WAIT_MS);
        return;
      case CLOSE_CODES.RESUME_INVALID:
        this.o.store.setItem(RESUME_KEY, "");
        this.retry = this.timers.set(() => this.open(), 0);
        this.setStatus("reconnecting");
        return;
      case CLOSE_CODES.IDLE_TIMEOUT:
        this.setStatus("idle");
        return;
      default:
        this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    this.cutShort = false;
    this.setStatus("reconnecting");
    const delay = reconnectDelay(this.attempt, this.o.random);
    this.attempt++;
    this.retry = this.timers.set(() => this.open(), delay);
  }

  private markClosed(): void {
    const r = readResume(this.o.store);
    if (r && r.closedAt === null) {
      this.o.store.setItem(RESUME_KEY, JSON.stringify({ ...r, closedAt: this.now() }));
    }
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.ws;
    this.ws = null;
    this.pingAt = null;
    this.stopSessionTimers();
    if (!ws) return;
    ws.onmessage = null;
    ws.onclose = null;
    this.markClosed();
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private stopSessionTimers(): void {
    for (const id of [this.stable, this.resample, this.heartbeat, ...this.samples]) {
      if (id !== null) this.timers.clear(id);
    }
    this.stable = this.resample = this.heartbeat = null;
    this.samples = [];
  }

  private cancelRetry(): void {
    if (this.retry !== null) this.timers.clear(this.retry);
    this.retry = null;
  }

  private setStatus(s: NetStatus): void {
    if (s === this.state) return;
    this.state = s;
    this.o.onStatus(s);
  }
}
