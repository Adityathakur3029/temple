import { describe, expect, it } from "vitest";
import {
  CLOSE_CODES,
  HEARTBEAT_MS,
  INTERP_DELAY_MS,
  RECONNECT_BASE_MS,
  RECONNECT_JITTER_MS,
  RECONNECT_MAX_MS,
  RESUME_WINDOW_MS,
  SPAWN,
  type RoomsResponse,
  type ServerMessage,
  type WelcomeMessage,
} from "@sannidhi/protocol";
import { ClockSync } from "../src/net/clock";
import { realtimeBase, socketBase } from "../src/net/config";
import {
  Connection,
  RESUME_KEY,
  PONG_TIMEOUT_MS,
  STRIKE_WAIT_MS,
  reconnectDelay,
  type NetStatus,
  type SocketLike,
  type Timers,
} from "../src/net/connection";
import { Presence, type Pose } from "../src/net/presence";
import { chooseHall } from "../src/net/rooms";
import { POS_GAP_MS, PosSender } from "../src/net/session";
import { memoryStore } from "../src/platform/storage";

// ---------------------------------------------------------------------------------------------
// Fakes: a clock with timers, and sockets that record what they were sent.
// ---------------------------------------------------------------------------------------------

class FakeTime implements Timers {
  now = 1_000_000;
  private next = 1;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): number {
    const id = this.next++;
    this.queue.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(id: number): void {
    this.queue.delete(id);
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.queue)
        if (e[1].at <= end && (!first || e[1].at < first[1].at)) first = e;
      if (!first) break;
      this.queue.delete(first[0]);
      this.now = first[1].at;
      first[1].fn();
    }
    this.now = end;
  }
}

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closedWith: number | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  receive(msg: ServerMessage | string): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop(code: number): void {
    this.onclose?.({ code });
  }
}

function welcome(over: Partial<WelcomeMessage> = {}): WelcomeMessage {
  return {
    t: "welcome",
    v: 1,
    you: { id: "k3", name: { key: "deodar", n: 214 }, shawl: 2, body: 1, joinedAt: 1 },
    hall: "hall-03",
    instance: 1,
    resume: "hall-03.1.AAAAAAAAAAAAAAAAAAAAAA",
    serverTime: 1_000_000,
    snapshot: {
      rev: 1,
      visitors: [],
      states: [],
      lamps: [],
      queues: { diya: 0, jal: 0 },
      today: { date: "2026-11-04", diyas: 0, malas: 0, parikramas: 0, visits: 0 },
    },
    ...over,
  };
}

function setup() {
  const time = new FakeTime();
  const store = memoryStore();
  const sockets: FakeSocket[] = [];
  const statuses: NetStatus[] = [];
  const welcomes: WelcomeMessage[] = [];
  const conn = new Connection({
    url: "ws://rt.test",
    store,
    lite: () => false,
    onWelcome: (w) => welcomes.push(w),
    onMessage: () => undefined,
    onStatus: (s) => statuses.push(s),
    socket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    now: () => time.now,
    random: () => 0,
    timers: time,
  });
  const last = (): FakeSocket => {
    const s = sockets[sockets.length - 1];
    if (!s) throw new Error("no socket");
    return s;
  };
  return { time, store, sockets, statuses, welcomes, conn, last };
}

// ---------------------------------------------------------------------------------------------

describe("clock sync (spec 04 § Clock sync)", () => {
  it("keeps the offset of the lowest round trip of the last five", () => {
    let now = 0;
    const clock = new ClockSync(() => now);
    clock.add(0, 5_100, 200); // rtt 200, off 5000
    clock.add(1000, 6_020, 1040); // rtt 40, off 5000
    clock.add(2000, 7_100, 2100); // rtt 100, off 5050
    expect(clock.offset).toBe(5000);
    for (let i = 0; i < 5; i++) clock.add(3000 + i, 3000 + i + 9_000 + 30, 3000 + i + 60);
    expect(clock.offset).toBe(9_000);
    now = 10;
    expect(clock.serverNow()).toBe(9_010);
  });

  it("agrees within 50 ms for two clients whose devices are 2 minutes apart", () => {
    const skew = 120_000;
    const server = (t: number): number => t + 7; // true time plus a fixed server offset
    const a = new ClockSync(() => 0);
    const b = new ClockSync(() => 0);
    for (let i = 0; i < 3; i++) {
      const t = 10_000 + i * 500;
      const rttA = 80 + i * 10;
      const rttB = 120 - i * 15;
      a.add(t, server(t + rttA / 2), t + rttA);
      b.add(t + skew, server(t + rttB / 2 + 6), t + skew + rttB); // a little asymmetry
    }
    const trueNow = 50_000;
    const aNow = trueNow + a.offset;
    const bNow = trueNow + skew + b.offset;
    expect(Math.abs(aNow - bNow)).toBeLessThan(50);
  });

  it("ignores impossible samples", () => {
    const clock = new ClockSync(() => 0);
    clock.add(100, 5, 50);
    expect(clock.synced).toBe(false);
  });
});

describe("reconnect back-off (spec 04 § Connection lifecycle)", () => {
  it("doubles from RECONNECT_BASE_MS up to RECONNECT_MAX_MS, plus jitter", () => {
    expect(reconnectDelay(0, () => 0)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelay(3, () => 0)).toBe(RECONNECT_BASE_MS * 8);
    expect(reconnectDelay(20, () => 0)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelay(0, () => 0.999)).toBeCloseTo(RECONNECT_BASE_MS + RECONNECT_JITTER_MS, 0);
  });
});

describe("Connection", () => {
  it("connects, keeps the resume token, samples the clock and sends heartbeats", () => {
    const { time, store, conn, last, statuses, welcomes } = setup();
    conn.start("hall-03");
    expect(last().url).toBe("ws://rt.test/ws?hall=hall-03&v=1");
    last().receive(welcome());
    expect(statuses).toContain("online");
    expect(welcomes).toHaveLength(1);
    expect(JSON.parse(store.getItem(RESUME_KEY) ?? "")).toMatchObject({
      token: "hall-03.1.AAAAAAAAAAAAAAAAAAAAAA",
      closedAt: null,
    });
    time.advance(1100);
    expect(last().sent.filter((s) => s.startsWith('{"t":"time"'))).toHaveLength(3);
    time.advance(HEARTBEAT_MS + 5000);
    expect(last().sent).toContain("ping");
  });

  it("resumes with the token after a drop, with back-off", () => {
    const { time, conn, last, sockets, statuses } = setup();
    conn.start("hall-03");
    last().receive(welcome());
    last().drop(1006);
    expect(statuses[statuses.length - 1]).toBe("reconnecting");
    expect(sockets).toHaveLength(1);
    time.advance(RECONNECT_BASE_MS);
    expect(sockets).toHaveLength(2);
    expect(last().url).toContain("&resume=hall-03.1.AAAAAAAAAAAAAAAAAAAAAA");
    last().drop(1006);
    time.advance(RECONNECT_BASE_MS); // the second wait is twice as long
    expect(sockets).toHaveLength(2);
    time.advance(RECONNECT_BASE_MS);
    expect(sockets).toHaveLength(3);
  });

  it("never cuts a back-off wait short for visitor activity; the network coming back may, once", () => {
    const { time, conn, last, sockets } = setup();
    conn.start("hall-03");
    last().receive(welcome());
    last().drop(1006);
    for (let i = 0; i < 5; i++) conn.wake(); // pointer moves, keys
    expect(sockets).toHaveLength(1);
    conn.reconnectNow(); // the online event
    expect(sockets).toHaveLength(2);
    last().drop(1006);
    conn.reconnectNow();
    expect(sockets).toHaveLength(3); // a new wait may be cut short once more
    last().drop(1006);
    conn.reconnectNow();
    conn.reconnectNow();
    expect(sockets).toHaveLength(4);
    last().drop(1006);
    time.advance(RECONNECT_MAX_MS + RECONNECT_JITTER_MS); // the back-off itself still runs
    expect(sockets).toHaveLength(5);
  });

  it("closes a socket that stops answering pings, and resumes", () => {
    const { time, conn, last, sockets, statuses } = setup();
    conn.start("hall-03");
    last().receive(welcome());
    time.advance(HEARTBEAT_MS + 5000); // a ping goes out
    expect(last().sent).toContain("ping");
    time.advance(PONG_TIMEOUT_MS + 5000); // and nothing comes back
    expect(statuses[statuses.length - 1]).toBe("reconnecting");
    time.advance(RECONNECT_BASE_MS + RECONNECT_JITTER_MS);
    expect(sockets.length).toBeGreaterThan(1);
    expect(last().url).toContain("resume=");
  });

  it("joins as new once the resume window has passed", () => {
    const { time, conn, last } = setup();
    conn.start("hall-03");
    last().receive(welcome());
    conn.pause();
    time.advance(RESUME_WINDOW_MS + 1);
    conn.wake();
    expect(last().url).not.toContain("resume=");
  });

  it("acts on each close code", () => {
    const cases: [number, NetStatus][] = [
      [CLOSE_CODES.VERSION_MISMATCH, "refresh"],
      [CLOSE_CODES.ORIGIN_NOT_ALLOWED, "error"],
      [CLOSE_CODES.HALL_FULL, "hall-full"],
      [CLOSE_CODES.IDLE_TIMEOUT, "idle"],
      [CLOSE_CODES.TOO_MANY_STRIKES, "waiting"],
    ];
    for (const [code, status] of cases) {
      const { time, conn, last, sockets, statuses } = setup();
      conn.start("hall-03");
      last().receive(welcome());
      last().drop(code);
      expect(statuses[statuses.length - 1], String(code)).toBe(status);
      time.advance(30_000);
      expect(sockets, String(code)).toHaveLength(1); // none of these retries quickly
      if (code === CLOSE_CODES.TOO_MANY_STRIKES) {
        time.advance(STRIKE_WAIT_MS);
        expect(sockets).toHaveLength(2);
        expect(last().url).not.toContain("resume=");
      }
      if (code === CLOSE_CODES.IDLE_TIMEOUT) {
        conn.wake(); // visitor activity
        expect(sockets).toHaveLength(2);
      }
    }
  });

  it("retries at once after 4001, and without the token after 4010", () => {
    const { time, conn, last, sockets } = setup();
    conn.start("hall-03");
    last().drop(CLOSE_CODES.INSTANCE_FULL);
    time.advance(RECONNECT_JITTER_MS);
    expect(sockets).toHaveLength(2);
    last().receive(welcome());
    last().drop(1006);
    time.advance(RECONNECT_BASE_MS);
    expect(last().url).toContain("resume=");
    last().drop(CLOSE_CODES.RESUME_INVALID);
    time.advance(0);
    expect(last().url).not.toContain("resume=");
  });

  it("leaves on purpose: sends leave, closes with 1000 and forgets the token", () => {
    const { store, conn, last } = setup();
    conn.start("hall-03");
    last().receive(welcome());
    const ws = last();
    conn.switchHall("hall-07");
    expect(ws.sent).toContain('{"t":"leave"}');
    expect(ws.closedWith).toBe(1000);
    expect(last().url).toBe("ws://rt.test/ws?hall=hall-07&v=1");
    expect(store.getItem(RESUME_KEY)).toBe("");
  });

  it("asks for Lite deltas", () => {
    const time = new FakeTime();
    let url = "";
    const conn = new Connection({
      url: "ws://rt.test",
      store: memoryStore(),
      lite: () => true,
      onWelcome: () => undefined,
      onMessage: () => undefined,
      onStatus: () => undefined,
      socket: (u) => {
        url = u;
        return new FakeSocket(u);
      },
      timers: time,
      now: () => time.now,
    });
    conn.start("hall-01");
    expect(url).toContain("&lite=1");
  });
});

describe("Presence and interpolation", () => {
  const w = welcome({
    snapshot: {
      ...welcome().snapshot,
      visitors: [
        { id: "k3", name: { key: "deodar", n: 214 }, shawl: 2, body: 1, joinedAt: 1 },
        { id: "m7", name: { key: "koel", n: 300 }, shawl: 5, body: 0, joinedAt: 1 },
      ],
      states: [
        ["k3", 0, 56.5, 3.14, 0, -1],
        ["m7", 0, 50, 0, 0, -1],
      ],
    },
  });
  const out: Pose = { x: 0, z: 0, yaw: 0, pose: 0, mat: -1 };

  it("keeps everyone but this visitor, and returns this visitor's state", () => {
    const p = new Presence();
    expect(p.applyWelcome(w)).toEqual(["k3", 0, 56.5, 3.14, 0, -1]);
    expect([...p.remotes.keys()]).toEqual(["m7"]);
  });

  it("draws remote avatars INTERP_DELAY_MS behind server time, between samples", () => {
    const p = new Presence();
    p.applyWelcome(w);
    const t0 = w.serverTime;
    p.applyDelta({ t: "delta", rev: 2, at: t0 + 100, up: [["m7", 0, 49.9, 0, 1, -1]] });
    p.applyDelta({ t: "delta", rev: 3, at: t0 + 200, up: [["m7", 0, 49.8, 0, 0, -1]] });
    const r = p.remotes.get("m7");
    if (!r) throw new Error("no m7");
    p.sample(r, t0 + 150 + INTERP_DELAY_MS, out);
    expect(out.z).toBeCloseTo(49.85, 5);
    p.sample(r, t0 + 5000, out);
    expect(out.z).toBeCloseTo(49.8, 5);
  });

  it("carries a walker on briefly when the next sample is late", () => {
    const p = new Presence();
    p.applyWelcome(w);
    const t0 = w.serverTime;
    p.applyDelta({ t: "delta", rev: 2, at: t0 + 100, up: [["m7", 0, 49.9, 0, 1, -1]] });
    p.applyDelta({ t: "delta", rev: 3, at: t0 + 200, up: [["m7", 0, 49.8, 0, 1, -1]] });
    const r = p.remotes.get("m7");
    if (!r) throw new Error("no m7");
    p.sample(r, t0 + 250 + INTERP_DELAY_MS, out); // 50 ms past the newest sample
    expect(out.z).toBeCloseTo(49.75, 5);
    p.sample(r, t0 + 5000, out); // never more than EXTRAPOLATE_MS
    expect(out.z).toBeCloseTo(49.65, 5);
  });

  it("starts smoothly after a long pause", () => {
    const p = new Presence();
    p.applyWelcome(w);
    const t0 = w.serverTime + 30_000;
    p.applyDelta({ t: "delta", rev: 2, at: t0, up: [["m7", 0, 49.87, 0, 1, -1]] });
    const r = p.remotes.get("m7");
    if (!r) throw new Error("no m7");
    // Just after the pause the avatar is still near where it stood, not most of the way there.
    p.sample(r, t0 - 80 + INTERP_DELAY_MS, out);
    expect(out.z).toBeGreaterThan(49.95);
  });

  it("applies gone, join and up, and ignores unknown or own ids", () => {
    const p = new Presence();
    let changes = 0;
    p.onChange = () => changes++;
    p.applyWelcome(w);
    p.applyDelta({
      t: "delta",
      rev: 2,
      at: 1,
      gone: ["m7", "zz"],
      join: [{ id: "q2", name: { key: "monal", n: 101 }, shawl: 0, body: 0, joinedAt: 2 }],
      up: [
        ["q2", 1, 2, 0, 0, 7],
        ["k3", 9, 9, 0, 0, -1],
      ],
    });
    expect([...p.remotes.keys()]).toEqual(["q2"]);
    expect(p.heldMats()).toEqual(new Set([7]));
    expect(changes).toBe(2);
  });
});

describe("PosSender", () => {
  it("sends only changes, at most POS_MAX_HZ, rounded", () => {
    const s = new PosSender();
    s.reset({ x: SPAWN.x, z: SPAWN.z, yaw: 3.14, pose: "stand" });
    expect(s.next(0, SPAWN.x, SPAWN.z, 3.1415, "stand")).toBeNull();
    expect(s.next(0, 0.123, 56, 3.1415, "walk")).toEqual({
      t: "pos",
      x: 0.12,
      z: 56,
      yaw: 3.14,
      pose: "walk",
    });
    expect(s.next(50, 0.2, 55.9, 3.14, "walk")).toBeNull();
    expect(s.next(POS_GAP_MS, 0.2, 55.9, 3.14, "walk")).not.toBeNull();
  });
});

describe("hall choice (spec 04 § Room list)", () => {
  const rooms = (counts: number[]): RoomsResponse => ({
    v: 1,
    serverTime: 0,
    today: { date: "2026-11-04", diyas: 0, malas: 0, parikramas: 0, visits: 0 },
    halls: counts.map((count, i) => ({
      id: `hall-${String(i + 1).padStart(2, "0")}`,
      number: i + 1,
      count,
      capacity: 400,
      instances: 1,
      checkedAt: 0,
    })),
  });

  it("rejoins the resume hall", () => {
    expect(chooseHall(rooms([300, 10]), "hall-02")).toBe("hall-02");
  });

  it("picks the fullest hall under 90%", () => {
    expect(chooseHall(rooms([5, 359, 361, 20]), null)).toBe("hall-02");
  });

  it("falls back to hall-01", () => {
    expect(chooseHall(rooms([390, 395]), null)).toBe("hall-01");
    expect(chooseHall(null, null)).toBe("hall-01");
  });
});

describe("config", () => {
  it("defaults to wrangler dev and turns http into ws", () => {
    expect(realtimeBase("")).toBe("http://localhost:8787");
    expect(realtimeBase("https://rt.example.dev/")).toBe("https://rt.example.dev");
    expect(socketBase("https://rt.example.dev")).toBe("wss://rt.example.dev");
    expect(socketBase("http://localhost:8787")).toBe("ws://localhost:8787");
  });
});
