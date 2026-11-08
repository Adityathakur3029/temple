/**
 * One load-test visitor speaking the real protocol from packages/protocol (spec 12 § Load and soak
 * tests). Behaviours: `wanderer` walks the gate path and courtyard, `bell-ringer` rings the bells
 * near the gate and greets, `reconnector` wanders and drops its connection now and then, coming
 * back with its resume token.
 */
import WebSocket from "ws";
import {
  BELL_COOLDOWN_MS,
  CLOSE_CODES,
  GATE_PATH,
  GESTURE_COOLDOWN_MS,
  HEARTBEAT_MS,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  POS_MAX_HZ,
  PROTOCOL_VERSION,
  SPAWN,
  WALK_SPEED_MPS,
  decodeServerMessage,
  isWalkable,
  roundCm,
  roundYaw,
  segmentBlocked,
  yawTowards,
  type BellId,
  type ClientMessage,
  type HallId,
  type Point,
} from "@sannidhi/protocol";

export const BEHAVIOURS = ["wanderer", "bell-ringer", "reconnector"] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

export interface BotOptions {
  /** ws(s)://host of the realtime Worker. */
  url: string;
  origin: string;
  hall: HallId;
  lite: boolean;
  behaviour: Behaviour;
  random: () => number;
}

/** What every bot measures; the runner adds them up. */
export interface BotStats {
  connects: number;
  connectMs: number[];
  deltaGapsMs: number[];
  bytesDown: number;
  bytesUp: number;
  corrects: number;
  closes: Record<string, number>;
  errors: number;
  resumes: number;
  resumesKept: number;
  instances: Set<number>;
  /** Bytes read from the network, after any WebSocket compression. */
  wireDown: number;
  /** The negotiated WebSocket extensions, e.g. "permessage-deflate". */
  extensions: string;
  /** Steps refused by the bot's own zone check (should stay 0). */
  stuck: number;
}

/**
 * The gate path, then the courtyard on each side of Nandi and back. Every leg is walkable and
 * none crosses the Nandi axis: the two sides of the courtyard connect only behind Nandi (z > 23).
 */
const ROUTE: readonly Point[] = [
  SPAWN,
  ...GATE_PATH.slice(1),
  { x: -5, z: 27 },
  { x: -6, z: 21.5 },
  { x: -5, z: 27 },
  { x: 5, z: 27 },
  { x: 6, z: 21.5 },
  { x: 5, z: 27 },
  { x: 0, z: 30 },
  ...[...GATE_PATH].reverse().slice(1),
];

const BELL_SPOT: Point = { x: -0.4, z: 45.2 };
const BELL_CHOICES: readonly BellId[] = ["gate", "path-1"];
const STEP_MS = 1000 / POS_MAX_HZ + 5;

export class Bot {
  readonly stats: BotStats = {
    connects: 0,
    connectMs: [],
    deltaGapsMs: [],
    bytesDown: 0,
    bytesUp: 0,
    corrects: 0,
    closes: {},
    errors: 0,
    resumes: 0,
    resumesKept: 0,
    instances: new Set(),
    wireDown: 0,
    extensions: "",
    stuck: 0,
  };
  private ws: WebSocket | null = null;
  private id: string | null = null;
  private resume: string | null = null;
  private at: Point = SPAWN;
  private leg = 0;
  private target: Point = SPAWN;
  private lastSent = 0;
  private lastDelta = 0;
  private lastBell = 0;
  private lastGesture = 0;
  private pauseUntil = 0;
  private nextDrop = 0;
  private stopped = false;
  private ticker: NodeJS.Timeout | null = null;
  private resumingAs: string | null = null;

  constructor(private readonly o: BotOptions) {}

  start(): void {
    this.connect();
    this.ticker = setInterval(() => this.tick(), STEP_MS);
  }

  /** Leaves on purpose, as a visitor closing the temple would. */
  stop(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ t: "leave" });
      this.ws.close(1000, "leave");
    } else this.ws?.terminate();
  }

  private connect(): void {
    if (this.stopped) return;
    const q = new URLSearchParams({ hall: this.o.hall, v: String(PROTOCOL_VERSION) });
    if (this.resume) q.set("resume", this.resume);
    if (this.o.lite) q.set("lite", "1");
    const started = Date.now();
    const ws = new WebSocket(`${this.o.url}/ws?${q.toString()}`, {
      headers: { Origin: this.o.origin },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.stats.extensions = ws.extensions;
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const text = (data as Buffer).toString("utf8");
      this.stats.bytesDown += Buffer.byteLength(text);
      if (text === HEARTBEAT_PONG) return;
      const msg = decodeServerMessage(text);
      if (!msg) return;
      switch (msg.t) {
        case "welcome":
          this.stats.connects++;
          this.stats.connectMs.push(Date.now() - started);
          this.stats.instances.add(msg.instance);
          if (this.resumingAs !== null) {
            this.stats.resumes++;
            if (msg.you.id === this.resumingAs) this.stats.resumesKept++;
            this.resumingAs = null;
          }
          this.id = msg.you.id;
          this.resume = msg.resume;
          this.lastDelta = 0;
          if (this.o.behaviour === "reconnector")
            this.nextDrop = Date.now() + 20_000 + this.o.random() * 20_000;
          break;
        case "delta": {
          const now = Date.now();
          if (this.lastDelta > 0) this.stats.deltaGapsMs.push(now - this.lastDelta);
          this.lastDelta = now;
          break;
        }
        case "correct":
          this.stats.corrects++;
          this.at = { x: msg.x, z: msg.z };
          break;
        case "error":
          this.stats.errors++;
          break;
        default:
          break;
      }
    });
    ws.on("close", (code) => {
      this.stats.wireDown += Bot.wireBytes(ws);
      if (this.ws !== ws) return;
      this.ws = null;
      const key = String(code);
      this.stats.closes[key] = (this.stats.closes[key] ?? 0) + 1;
      if (this.stopped) return;
      // 4010: the token expired; 4001: the instance filled; others: a dropped network.
      if (code === CLOSE_CODES.RESUME_INVALID) this.resume = null;
      const wait =
        code === CLOSE_CODES.TOO_MANY_STRIKES
          ? 60_000
          : code === CLOSE_CODES.INSTANCE_FULL || code === CLOSE_CODES.RESUME_INVALID
            ? 0
            : 1000 + this.o.random() * 2000;
      setTimeout(() => this.connect(), wait);
    });
    ws.on("error", () => {
      this.stats.errors++;
    });
  }

  /** Bytes the TCP socket has read so far (the `ws` package keeps it on `_socket`). */
  static wireBytes(ws: WebSocket): number {
    return (ws as unknown as { _socket?: { bytesRead?: number } })._socket?.bytesRead ?? 0;
  }

  /** Wire bytes read so far, including the open socket. */
  wireDownNow(): number {
    return this.stats.wireDown + (this.ws ? Bot.wireBytes(this.ws) : 0);
  }

  private send(msg: ClientMessage | string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.id === null) return;
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    ws.send(text);
    this.stats.bytesUp += Buffer.byteLength(text);
    this.lastSent = Date.now();
  }

  private tick(): void {
    if (this.stopped || !this.ws || this.id === null) return;
    const now = Date.now();
    if (this.o.behaviour === "reconnector" && this.nextDrop > 0 && now > this.nextDrop) {
      // Lose the network: no close frame, just gone. Come back within the resume window.
      this.nextDrop = 0;
      this.resumingAs = this.id;
      const ws = this.ws;
      this.ws = null;
      this.id = null;
      ws.terminate();
      this.stats.closes["dropped"] = (this.stats.closes["dropped"] ?? 0) + 1;
      setTimeout(() => this.connect(), 1000 + this.o.random() * 4000);
      return;
    }
    if (this.o.behaviour === "bell-ringer") this.ring(now);
    else this.wander(now);
    if (now - this.lastSent >= HEARTBEAT_MS) this.send(HEARTBEAT_PING);
  }

  private ring(now: number): void {
    if (Math.hypot(this.at.x - BELL_SPOT.x, this.at.z - BELL_SPOT.z) > 0.05) {
      this.stepTowards(BELL_SPOT);
      return;
    }
    if (now - this.lastBell > BELL_COOLDOWN_MS + 200 + this.o.random() * 5000) {
      this.lastBell = now;
      const bell = BELL_CHOICES[Math.floor(this.o.random() * BELL_CHOICES.length)] ?? "gate";
      this.send({ t: "bell", bell });
    } else if (now - this.lastGesture > GESTURE_COOLDOWN_MS * 4 && this.o.random() < 0.02) {
      this.lastGesture = now;
      this.send({ t: "gesture", g: "namaste" });
    }
  }

  private wander(now: number): void {
    if (now < this.pauseUntil) return;
    if (Math.hypot(this.at.x - this.target.x, this.at.z - this.target.z) < 0.05) {
      this.leg = (this.leg + 1) % ROUTE.length;
      const p = ROUTE[this.leg] ?? SPAWN;
      // A little to one side of the centre line, if that is walkable too.
      const side = { x: p.x + (this.o.random() - 0.5) * 1.2, z: p.z };
      this.target = isWalkable(side.x, side.z) && !segmentBlocked(this.at, side) ? side : p;
      if (this.o.random() < 0.15) this.pauseUntil = now + 1000 + this.o.random() * 6000;
      return;
    }
    this.stepTowards(this.target);
  }

  /** One step at walking pace, never across a blocked or sacred zone. */
  private stepTowards(to: Point): void {
    const d = Math.hypot(to.x - this.at.x, to.z - this.at.z);
    const step = WALK_SPEED_MPS * (STEP_MS / 1000);
    const k = d <= step ? 1 : step / d;
    const next = {
      x: roundCm(this.at.x + (to.x - this.at.x) * k),
      z: roundCm(this.at.z + (to.z - this.at.z) * k),
    };
    if (segmentBlocked(this.at, next)) {
      // Never step on a blocked or sacred zone: go on to the next point of the route instead.
      this.stats.stuck++;
      this.leg = (this.leg + 1) % ROUTE.length;
      this.target = ROUTE[this.leg] ?? SPAWN;
      return;
    }
    this.send({ t: "pos", ...next, yaw: roundYaw(yawTowards(this.at, to)), pose: "walk" });
    this.at = next;
  }
}
