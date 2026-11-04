import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_CODES,
  COUNTERS_PUSH_MS,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  INSTANCE_CAPACITY,
  LITE_TICK_HZ,
  PROTOCOL_VERSION,
  RESUME_WINDOW_MS,
  SERVER_IDLE_TIMEOUT_MS,
  SPAWN,
  TICK_HZ,
  decodeClientMessage,
  inMandapa,
  isHallId,
  istDate,
  roundYaw,
  type ClientMessage,
  type DeltaMessage,
  type HallId,
  type ServerMessage,
  type StateTuple,
  type TodayCounters,
  type Visitor,
  type VisitorId,
  type WelcomeMessage,
} from "@sannidhi/protocol";
import type { CounterBatch, CounterName, DirectoryDO } from "./directory";
import { BellWindows, inBellReach } from "./rules/bells";
import { newResumeToken, newVisitor, newVisitorId } from "./rules/identity";
import { Buckets, RATE_ERROR_EVERY_MS, addStrike } from "./rules/limits";
import { nearestFreeMat } from "./rules/mats";
import { POSE, checkMove, isSeated, type Place } from "./rules/movement";

/** The Worker names the instance in this header when it forwards an upgrade. */
export const ROOM_HEADER = "x-sannidhi-room";
/** Join and leave reports to the DirectoryDO are debounced this long (spec 05 § Capacity). */
export const REPORT_DEBOUNCE_MS = 2000;
/** The alarm ticks this often while anyone is connected: count report, idle sweep, counters. */
export const ROOM_TICK_MS = 30_000;
/** Counter increments are sent to the DirectoryDO this long after the first one is pending. */
export const COUNTER_FLUSH_MS = 10_000;

/** Everything about a connected visitor that must survive hibernation (spec 05 § State). ≤ 2 KB. */
export interface Attachment {
  visitor: Visitor;
  place: Place;
  lite: boolean;
  /** This connection's resume token. Never logged. */
  token: string;
  /** Server ms of the last message from this visitor (pings are tracked by the runtime). */
  lastAt: number;
  /** Strike times within the last 60 s. */
  strikes: number[];
  /** Set when the server is closing this socket, so a rebuild skips it. */
  closing?: true;
}

/**
 * `resume:<token>` in storage (spec 05 § Resume). Written at join with `until: null` and kept
 * up to date when the mat changes, so a place survives even a reset that drops sockets without a
 * close event (a deploy). On disconnect `until` becomes now + RESUME_WINDOW_MS.
 */
export interface StoredRecord {
  visitor: Visitor;
  place: Place;
  until: number | null;
}

/** A place held for a visitor who may resume. */
export interface ResumeRecord extends StoredRecord {
  until: number;
}

/** Report retries back off up to this, while the DirectoryDO is failing. */
const REPORT_RETRY_MAX_MS = 60_000;

interface Conn {
  ws: WebSocket;
  a: Attachment;
}

/**
 * Changes waiting for the next delta. An id is in both `join` and `gone` only when a new visitor
 * got a recently freed id; clients apply `gone` first, so the old one's samples go.
 */
interface Pending {
  join: Map<VisitorId, Visitor>;
  up: Set<VisitorId>;
  gone: Set<VisitorId>;
}

export interface RoomStats {
  sockets: number;
  held: number;
  flushes: number;
  flushP95Ms: number;
  flushMaxMs: number;
}

type FlushKind = "full" | "lite";
type Outcome = "hold" | "free" | "replaced";

const pending = (): Pending => ({ join: new Map(), up: new Set(), gone: new Set() });

function tuple(c: Conn): StateTuple {
  const p = c.a.place;
  return [c.a.visitor.id, p.x, p.z, p.yaw, p.pose, p.mat];
}

/** "hall-03#2" → { hall, instance }. */
export function parseRoomName(name: string | null): { hall: HallId; instance: number } | null {
  const m = /^(hall-\d{2})#(\d)$/.exec(name ?? "");
  const hall = m?.[1];
  return m && isHallId(hall) ? { hall, instance: Number(m[2]) } : null;
}

/**
 * One hall instance, named "hall-03#2" (spec 05 § RoomDO): presence, the movement rule,
 * gestures, bells and mats, deltas, resume, heartbeat, idle sweep, strikes and rate limits.
 * Diya, jal, japa and pradakshina arrive with M3, aarti with M4.
 */
export class RoomDO extends DurableObject<Env> {
  private room: { hall: HallId; instance: number } | null = null;
  private readonly conns = new Map<VisitorId, Conn>();
  private readonly byWs = new Map<WebSocket, Conn>();
  private readonly resumes = new Map<string, ResumeRecord>();
  private readonly buckets = new Map<VisitorId, Buckets>();
  private readonly bells = new BellWindows();
  private readonly acc: Record<FlushKind, Pending> = { full: pending(), lite: pending() };
  private readonly flushTimers: Record<FlushKind, ReturnType<typeof setTimeout> | null> = {
    full: null,
    lite: null,
  };
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReported: number | null = null;
  private reportFailures = 0;
  /** Connected Lite sockets; with none, no Lite deltas are built. */
  private liteSockets = 0;
  /** Starts at the wall clock so a new incarnation never repeats an older revision. */
  private rev = Date.now();
  private today: TodayCounters | null = null;
  private lastCountersPush = 0;
  private counters: { batch: CounterBatch; since: number } | null = null;
  private readonly flushMs: number[] = [];
  private flushes = 0;
  /** Per-IP socket counts, keyed by a salted hash. Memory only, never stored or logged. */
  private readonly ip = {
    salt: null as Uint8Array | null,
    saltAt: 0,
    counts: new Map<string, number>(),
    of: new Map<VisitorId, string>(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat pings are answered by the runtime without waking the object (spec 05 § Heartbeat).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
    // After hibernation, rebuild the visitors from their sockets' attachments (spec 05 § State).
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || a.closing) continue;
      const conn = { ws, a };
      this.conns.set(a.visitor.id, conn);
      this.byWs.set(ws, conn);
      if (a.lite) this.liteSockets++;
    }
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<{ hall: HallId; instance: number }>("room")) ?? null;
      const open = new Set([...this.conns.values()].map((c) => c.a.token));
      const now = Date.now();
      for (const [key, rec] of await ctx.storage.list<StoredRecord>({ prefix: "resume:" })) {
        const token = key.slice("resume:".length);
        if (rec.until !== null) {
          this.resumes.set(token, { ...rec, until: rec.until });
        } else if (!open.has(token)) {
          // Its socket went away without a close event (a deploy or reset): hold the place.
          const held: ResumeRecord = { ...rec, until: now + RESUME_WINDOW_MS };
          this.resumes.set(token, held);
          await ctx.storage.put(key, held);
        }
      }
      if (this.resumes.size > 0) await this.ensureAlarm();
      this.counters =
        (await ctx.storage.get<{ batch: CounterBatch; since: number }>("pending-counters")) ?? null;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Joining
  // -------------------------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (!this.room) {
      const named = parseRoomName(request.headers.get(ROOM_HEADER));
      if (!named) return new Response("Unknown room", { status: 400 });
      this.room = named;
      void this.ctx.storage.put("room", named);
    }
    const url = new URL(request.url);
    const lite = url.searchParams.get("lite") === "1";
    const token = url.searchParams.get("resume");

    // Everything that waits on I/O comes first, so the checks below and the join that follows
    // run without another event slipping in between.
    const ipKey = await this.ipKey(request.headers.get("CF-Connecting-IP"));
    if (!this.today || this.today.date !== istDate(Date.now())) await this.refreshToday();

    const now = Date.now();
    const cap = Number(this.env.PER_IP_SOCKET_CAP);
    // A takeover adds no socket (the old one closes), so it is never refused for the cap.
    const takeover = token !== null && !this.resumes.has(token) && this.connByToken(token);
    if (!takeover && ipKey !== null && cap > 0 && (this.ip.counts.get(ipKey) ?? 0) >= cap) {
      return this.reject(CLOSE_CODES.TOO_MANY_STRIKES, "ip");
    }

    let resumed: ResumeRecord | null = null;
    let strikes: number[] = [];
    if (token !== null) {
      const rec = this.resumes.get(token);
      const open = rec ? undefined : this.connByToken(token);
      if (open) {
        // The old socket is still open here, though the visitor has moved on (Wi-Fi to mobile
        // data, say): the new socket takes over the same visitor, name, place and mat.
        resumed = { visitor: open.a.visitor, place: open.a.place, until: now };
        strikes = open.a.strikes;
        this.closeConn(open, CLOSE_CODES.NORMAL, "replaced", "replaced");
      } else {
        if (!rec || rec.until <= now) return this.reject(CLOSE_CODES.RESUME_INVALID, "resume");
        this.resumes.delete(token);
        resumed = rec;
      }
      void this.ctx.storage.delete(`resume:${token}`);
    } else if (this.occupied(now) >= INSTANCE_CAPACITY) {
      this.reportNow();
      return this.reject(CLOSE_CODES.INSTANCE_FULL, "full");
    }

    const { hall, instance } = this.room;
    const visitor = resumed?.visitor ?? this.makeVisitor(now);
    // After a resume too, the first position may be anywhere walkable: the visitor may have
    // walked on while their network was away (the temple keeps working alone).
    const place: Place = resumed
      ? { ...resumed.place, posAt: now, firstPos: true }
      : {
          x: SPAWN.x,
          z: SPAWN.z,
          yaw: roundYaw(SPAWN.yaw),
          pose: POSE.stand,
          mat: -1,
          posAt: now,
          firstPos: true,
        };
    const a: Attachment = {
      visitor,
      place,
      lite,
      token: newResumeToken(hall, instance),
      lastAt: now,
      strikes,
    };

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, lite ? ["lite"] : []);
    server.serializeAttachment(a);
    const conn = { ws: server, a };
    this.conns.set(visitor.id, conn);
    this.byWs.set(server, conn);
    if (lite) this.liteSockets++;
    this.saveRecord(conn);
    if (ipKey !== null) {
      this.ip.counts.set(ipKey, (this.ip.counts.get(ipKey) ?? 0) + 1);
      this.ip.of.set(visitor.id, ipKey);
    }

    const welcome: WelcomeMessage = {
      t: "welcome",
      v: PROTOCOL_VERSION,
      you: visitor,
      hall,
      instance,
      resume: a.token,
      serverTime: now,
      snapshot: {
        rev: this.rev,
        visitors: [...this.conns.values()].map((c) => c.a.visitor),
        states: [...this.conns.values()].map(tuple),
        lamps: [],
        queues: { diya: 0, jal: 0 },
        today: this.today ?? { date: istDate(now), diyas: 0, malas: 0, parikramas: 0, visits: 0 },
      },
    };
    server.send(JSON.stringify(welcome));

    this.markJoin(visitor, resumed !== null);
    // Distinct visits: welcomes that didn't resume (spec 05 § DirectoryDO). No identifier is kept.
    if (!resumed) this.count("visits", now);
    this.scheduleReport();
    void this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Accept the upgrade only to close it with a code the client can act on (spec 04). */
  private reject(code: number, reason: string): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    server.close(code, reason);
    this.log("ws_rejected", { code });
    return new Response(null, { status: 101, webSocket: client });
  }

  private connByToken(token: string): Conn | undefined {
    for (const c of this.conns.values()) if (c.a.token === token) return c;
    return undefined;
  }

  /** The open connection's record, so its place outlives a reset (see StoredRecord). */
  private saveRecord(conn: Conn): void {
    const rec: StoredRecord = { visitor: conn.a.visitor, place: conn.a.place, until: null };
    void this.ctx.storage.put(`resume:${conn.a.token}`, rec);
  }

  /** Connected visitors plus places held for those who may resume. */
  private occupied(now: number): number {
    let held = 0;
    for (const r of this.resumes.values()) if (r.until > now) held++;
    return this.conns.size + held;
  }

  private makeVisitor(now: number): Visitor {
    const ids = new Set<VisitorId>(this.conns.keys());
    const numbers = new Set<number>();
    for (const c of this.conns.values()) numbers.add(c.a.visitor.name.n);
    for (const r of this.resumes.values()) {
      ids.add(r.visitor.id);
      numbers.add(r.visitor.name.n);
    }
    return newVisitor(newVisitorId(ids), numbers, now);
  }

  /** A salted hash of the client IP, or null without one. The salt changes daily. */
  private async ipKey(ip: string | null): Promise<string | null> {
    if (!ip) return null;
    const now = Date.now();
    if (!this.ip.salt || now - this.ip.saltAt > 86_400_000) {
      this.ip.salt = crypto.getRandomValues(new Uint8Array(16));
      this.ip.saltAt = now;
      this.ip.counts.clear();
      this.ip.of.clear();
    }
    const data = new Uint8Array([...this.ip.salt, ...new TextEncoder().encode(ip)]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const conn = this.byWs.get(ws);
    if (!conn) return;
    const now = Date.now();
    conn.a.lastAt = now;
    try {
      if (typeof message !== "string") return this.strike(conn, now);
      const decoded = decodeClientMessage(message);
      if (!decoded.ok) return this.strike(conn, now);
      const msg = decoded.msg;
      const buckets = this.bucketsFor(conn.a.visitor.id);
      if (!buckets.take(msg.t, now)) {
        if (now - buckets.lastRateError >= RATE_ERROR_EVERY_MS) {
          buckets.lastRateError = now;
          this.send(conn, { t: "error", code: "rate_limited" });
        }
        return this.strike(conn, now);
      }
      this.handle(conn, msg, now);
    } catch {
      // A handler bug never closes the socket. Logged without visitor data.
      this.log("handler_error", {});
    } finally {
      if (this.byWs.has(ws)) ws.serializeAttachment(conn.a);
    }
  }

  private handle(conn: Conn, msg: ClientMessage, now: number): void {
    const a = conn.a;
    const id = a.visitor.id;
    switch (msg.t) {
      case "pos": {
        const verdict = checkMove(a.place, msg, now);
        if (!verdict.ok) {
          this.send(conn, { t: "correct", x: a.place.x, z: a.place.z });
          return;
        }
        const before = a.place;
        a.place = verdict.place;
        if (before.mat !== a.place.mat) this.saveRecord(conn);
        if (
          before.x !== a.place.x ||
          before.z !== a.place.z ||
          before.yaw !== a.place.yaw ||
          before.pose !== a.place.pose ||
          before.mat !== a.place.mat
        ) {
          this.markUp(id);
        }
        return;
      }
      case "gesture":
        // Take aarti and prasad are only accepted in the window after aarti, which arrives in M4.
        if (msg.g === "namaste" || msg.g === "pranam") {
          this.broadcast({ t: "event", from: id, kind: msg.g }, conn);
        }
        return;
      case "bell":
        if (inBellReach(a.place, msg.bell) && this.bells.allow(msg.bell, now)) {
          this.broadcast({ t: "event", from: id, kind: "bell", bell: msg.bell }, conn);
        }
        return;
      case "sit": {
        const held = this.heldMats(id);
        const mat = msg.mat ?? nearestFreeMat(a.place, held);
        if (!inMandapa(a.place.x, a.place.z) || mat < 0 || held.has(mat)) {
          this.send(conn, { t: "sit.no", req: msg.req });
          return;
        }
        if (isSeated(a.place)) a.place = { ...a.place, pose: POSE.stand };
        a.place = { ...a.place, mat };
        this.saveRecord(conn);
        this.send(conn, { t: "sit.ok", req: msg.req, mat });
        this.markUp(id);
        return;
      }
      case "stand":
        if (a.place.mat < 0) return;
        a.place = { ...a.place, mat: -1, pose: isSeated(a.place) ? POSE.stand : a.place.pose };
        this.saveRecord(conn);
        this.markUp(id);
        return;
      case "time":
        this.send(conn, { t: "time", c: msg.c, s: now });
        return;
      case "leave":
        this.closeConn(conn, CLOSE_CODES.NORMAL, "leave", "free");
        return;
      default:
        // Diya, jal and japa arrive with M3. Valid messages, so no strike.
        return;
    }
  }

  /** Mats held by connected visitors and resume records, except `except`'s own. */
  private heldMats(except: VisitorId): Set<number> {
    const held = new Set<number>();
    for (const c of this.conns.values()) {
      if (c.a.visitor.id !== except && c.a.place.mat >= 0) held.add(c.a.place.mat);
    }
    const now = Date.now();
    for (const r of this.resumes.values()) {
      if (r.until > now && r.place.mat >= 0) held.add(r.place.mat);
    }
    return held;
  }

  private bucketsFor(id: VisitorId): Buckets {
    let b = this.buckets.get(id);
    if (!b) {
      b = new Buckets();
      this.buckets.set(id, b);
    }
    return b;
  }

  private strike(conn: Conn, now: number): void {
    if (addStrike(conn.a.strikes, now)) {
      this.log("strikes", { code: CLOSE_CODES.TOO_MANY_STRIKES });
      // No resume: the client waits 60 s, longer than the window (spec 04 § Close codes).
      this.closeConn(conn, CLOSE_CODES.TOO_MANY_STRIKES, "strikes", "free");
    }
  }

  // -------------------------------------------------------------------------------------------
  // Leaving
  // -------------------------------------------------------------------------------------------

  /**
   * The server closes a socket. `hold` keeps the place for the resume window, as for a dropped
   * network; `free` lets it go at once (leave, strikes); `replaced` means a new socket took over.
   */
  private closeConn(conn: Conn, code: number, reason: string, outcome: Outcome): void {
    conn.a.closing = true;
    try {
      conn.ws.serializeAttachment(conn.a);
    } catch {
      // Already closed.
    }
    this.disconnect(conn, outcome);
    try {
      conn.ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private disconnect(conn: Conn, outcome: Outcome): void {
    const id = conn.a.visitor.id;
    this.conns.delete(id);
    this.byWs.delete(conn.ws);
    if (conn.a.lite) this.liteSockets--;
    if (outcome === "replaced") {
      // The same visitor continues on a new socket, which keeps their buckets and strikes.
      this.forgetIp(id);
      return;
    }
    this.buckets.delete(id);
    this.forgetIp(id);
    if (outcome === "hold") {
      const rec: ResumeRecord = {
        visitor: conn.a.visitor,
        place: conn.a.place,
        until: Date.now() + RESUME_WINDOW_MS,
      };
      this.resumes.set(conn.a.token, rec);
      void this.ctx.storage.put(`resume:${conn.a.token}`, rec);
    } else {
      void this.ctx.storage.delete(`resume:${conn.a.token}`);
    }
    this.markGone(id);
    this.scheduleReport();
    void this.ensureAlarm();
  }

  private forgetIp(id: VisitorId): void {
    const key = this.ip.of.get(id);
    if (key === undefined) return;
    this.ip.of.delete(id);
    const n = (this.ip.counts.get(key) ?? 1) - 1;
    if (n > 0) this.ip.counts.set(key, n);
    else this.ip.counts.delete(key);
  }

  /** The visitor's network went away, or they closed the tab: hold their place (spec 05 § Resume). */
  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const conn = this.byWs.get(ws);
    if (conn) this.disconnect(conn, "hold");
    // 1005 and 1006 are reserved: they describe a close but can't be sent in one.
    const reply = code === 1005 || code === 1006 ? CLOSE_CODES.NORMAL : code;
    try {
      ws.close(reply, reason);
    } catch {
      // The runtime may already have answered the close.
    }
  }

  override webSocketError(ws: WebSocket): void {
    const conn = this.byWs.get(ws);
    if (conn) this.disconnect(conn, "hold");
    try {
      // The server met an error; the client resumes, as for any unexpected close.
      ws.close(CLOSE_CODES.SERVER_ERROR);
    } catch {
      // Already closed.
    }
  }

  // -------------------------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------------------------

  private send(conn: Conn, msg: ServerMessage): void {
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      // The socket is closing; its close handler cleans up.
    }
  }

  /** Visible actions go out at once, to everyone but the visitor who did them. */
  private broadcast(msg: ServerMessage, except: Conn | null): void {
    const frame = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      if (c === except) continue;
      try {
        c.ws.send(frame);
      } catch {
        // Closing.
      }
    }
  }

  /**
   * `resumed`: the same visitor is back, so a pending `gone` is cancelled. A new visitor who
   * happens to get a recent id keeps it, so clients drop the old one's samples first.
   */
  private markJoin(v: Visitor, resumed: boolean): void {
    for (const p of [this.acc.full, this.acc.lite]) {
      if (resumed) p.gone.delete(v.id);
      p.join.set(v.id, v);
      p.up.add(v.id);
    }
    this.scheduleFlush();
  }

  private markUp(id: VisitorId): void {
    for (const p of [this.acc.full, this.acc.lite]) p.up.add(id);
    this.scheduleFlush();
  }

  private markGone(id: VisitorId): void {
    for (const p of [this.acc.full, this.acc.lite]) {
      p.join.delete(id);
      p.up.delete(id);
      // Always sent, even for a visitor who joined in this window: someone who arrived meanwhile
      // has them in their snapshot. Clients ignore `gone` for ids they don't know.
      p.gone.add(id);
    }
    this.scheduleFlush();
  }

  /** Coalesce changes: at most TICK_HZ deltas, and LITE_TICK_HZ for Lite sockets (spec 05 § Timers). */
  private scheduleFlush(): void {
    if (!this.flushTimers.full) {
      this.flushTimers.full = setTimeout(() => this.flush("full"), 1000 / TICK_HZ);
    }
    if (this.liteSockets > 0 && !this.flushTimers.lite) {
      this.flushTimers.lite = setTimeout(() => this.flush("lite"), 1000 / LITE_TICK_HZ);
    } else if (this.liteSockets === 0) {
      // A Lite socket that joins later starts from its own snapshot.
      this.acc.lite = pending();
    }
  }

  private flush(kind: FlushKind): void {
    this.flushTimers[kind] = null;
    const p = this.acc[kind];
    if (p.join.size === 0 && p.up.size === 0 && p.gone.size === 0) return;
    const t0 = performance.now();
    const delta: DeltaMessage = { t: "delta", rev: ++this.rev, at: Date.now() };
    if (p.join.size > 0) delta.join = [...p.join.values()];
    const up: StateTuple[] = [];
    for (const id of p.up) {
      const c = this.conns.get(id);
      if (c) up.push(tuple(c));
    }
    if (up.length > 0) delta.up = up;
    if (p.gone.size > 0) delta.gone = [...p.gone];
    this.acc[kind] = pending();

    const frame = JSON.stringify(delta);
    const lite = kind === "lite";
    for (const c of this.conns.values()) {
      if (c.a.lite !== lite) continue;
      try {
        c.ws.send(frame);
      } catch {
        // Closing.
      }
    }
    this.recordFlush(performance.now() - t0);
  }

  private recordFlush(ms: number): void {
    this.flushes++;
    this.flushMs.push(ms);
    if (this.flushMs.length > 1000) this.flushMs.splice(0, this.flushMs.length - 1000);
  }

  // -------------------------------------------------------------------------------------------
  // Directory, counters and the alarm
  // -------------------------------------------------------------------------------------------

  private directory(): DurableObjectStub<DirectoryDO> {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("directory"));
  }

  private scheduleReport(): void {
    if (this.reportTimer) return;
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      void this.report();
    }, REPORT_DEBOUNCE_MS);
  }

  /** An instance that just turned someone away tells the directory straight away. */
  private reportNow(): void {
    if (this.reportTimer) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    void this.report();
  }

  private async report(): Promise<void> {
    if (!this.room) return;
    // Held places count: the room would refuse a newcomer for them (spec 05 § Capacity).
    const count = this.occupied(Date.now());
    try {
      this.today = await this.directory().report(this.room.hall, this.room.instance, count);
      this.lastReported = count;
      this.reportFailures = 0;
    } catch {
      this.reportFailures++;
      this.log("directory_error", {});
    }
  }

  private async refreshToday(): Promise<void> {
    try {
      this.today = await this.directory().todayCounters();
    } catch {
      this.log("directory_error", {});
    }
  }

  /** Batches a temple-wide counter increment (spec 03 § Temple-wide "today" counters). */
  private count(name: CounterName, now: number): void {
    const date = istDate(now);
    const c = (this.counters ??= { batch: {}, since: now });
    const day = (c.batch[date] ??= {});
    day[name] = (day[name] ?? 0) + 1;
    void this.ctx.storage.put("pending-counters", c);
    void this.ensureAlarm();
  }

  private async flushCounters(): Promise<void> {
    const c = this.counters;
    if (!c) return;
    try {
      this.today = await this.directory().addCounters(c.batch);
      // Increments that arrived while the call was out stay pending.
      if (this.counters === c) {
        this.counters = null;
        await this.ctx.storage.delete("pending-counters");
      }
    } catch {
      this.log("directory_error", {});
    }
  }

  /** The earliest of: resume expiry, the room tick while anyone is here, the counter flush. */
  private nextAlarm(now: number): number | null {
    let next = Number.POSITIVE_INFINITY;
    for (const r of this.resumes.values()) next = Math.min(next, r.until);
    if (this.conns.size > 0) next = Math.min(next, now + ROOM_TICK_MS);
    if (this.counters) next = Math.min(next, this.counters.since + COUNTER_FLUSH_MS);
    // An instance that emptied still owes the directory its zero count.
    if (this.conns.size === 0 && this.lastReported !== this.occupied(now)) {
      const wait = Math.min(REPORT_RETRY_MAX_MS, REPORT_DEBOUNCE_MS * 2 ** this.reportFailures);
      next = Math.min(next, now + wait);
    }
    return Number.isFinite(next) ? Math.max(next, now) : null;
  }

  private async ensureAlarm(): Promise<void> {
    const next = this.nextAlarm(Date.now());
    if (next === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const [token, rec] of this.resumes) {
      if (rec.until <= now) {
        this.resumes.delete(token);
        await this.ctx.storage.delete(`resume:${token}`);
      }
    }
    // Idle sweep: no message and no heartbeat for SERVER_IDLE_TIMEOUT_MS (spec 05 § Timers).
    for (const conn of [...this.conns.values()]) {
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(conn.ws)?.getTime() ?? 0;
      if (now - Math.max(conn.a.lastAt, ping) > SERVER_IDLE_TIMEOUT_MS) {
        this.closeConn(conn, CLOSE_CODES.IDLE_TIMEOUT, "idle", "hold");
      }
    }
    if (this.counters && now - this.counters.since >= COUNTER_FLUSH_MS) await this.flushCounters();
    if (this.conns.size > 0 || this.lastReported !== this.occupied(now)) await this.report();
    if (this.conns.size > 0 && now - this.lastCountersPush >= COUNTERS_PUSH_MS && this.today) {
      this.lastCountersPush = now;
      this.broadcast({ t: "counters", today: this.today }, null);
    }
    if (this.flushes > 0) this.log("flush_stats", { ms: this.stats().flushP95Ms });

    const next = this.nextAlarm(Date.now());
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  // -------------------------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------------------------

  /** Load-test numbers (spec 12). The Worker serves them only where DEV_STATS is "1". */
  stats(): RoomStats {
    const sorted = [...this.flushMs].sort((x, y) => x - y);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    return {
      sockets: this.conns.size,
      held: this.occupied(Date.now()) - this.conns.size,
      flushes: this.flushes,
      flushP95Ms: Math.round(p95 * 100) / 100,
      flushMaxMs: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
    };
  }

  /** Structured logs: event, hall, instance, code, ms. Never IPs, user agents, tokens or names. */
  private log(event: string, fields: { code?: number; ms?: number }): void {
    console.log(
      JSON.stringify({ event, hall: this.room?.hall, instance: this.room?.instance, ...fields }),
    );
  }
}
