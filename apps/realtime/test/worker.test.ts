import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  CLOSE_CODES,
  HALL_COUNT,
  INSTANCE_CAPACITY,
  INSTANCES_PER_HALL,
  PROTOCOL_VERSION,
  type RoomsResponse,
} from "@sannidhi/protocol";
import { clearRoomsCache } from "../src/rooms";
import { APP_ORIGIN, TestClient, fetchWorker, wait } from "./client";

describe("GET /api/rooms", () => {
  it("returns 20 halls in the spec 04 shape", async () => {
    const res = await fetchWorker("/api/rooms", { headers: { Origin: APP_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json<RoomsResponse>();
    expect(body.v).toBe(PROTOCOL_VERSION);
    expect(Math.abs(body.serverTime - Date.now())).toBeLessThan(5000);
    expect(body.halls).toHaveLength(HALL_COUNT);
    expect(body.halls[0]).toMatchObject({
      id: "hall-01",
      number: 1,
      capacity: INSTANCE_CAPACITY * INSTANCES_PER_HALL,
    });
    expect(body.halls[19]?.id).toBe("hall-20");
    expect(body.today).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
      diyas: expect.any(Number) as unknown,
      malas: expect.any(Number) as unknown,
      parikramas: expect.any(Number) as unknown,
      visits: expect.any(Number) as unknown,
    });
  });

  it("counts the visitors in a hall, once their room has reported", async () => {
    const { c } = await TestClient.join({ hall: "hall-20" });
    await wait(2300); // the room reports joins after a 2 s debounce
    clearRoomsCache();
    const body = await (await fetchWorker("/api/rooms")).json<RoomsResponse>();
    expect(body.halls[19]).toMatchObject({ id: "hall-20", count: 1, instances: 1 });
    expect(body.today.visits).toBeGreaterThanOrEqual(0);
    await c.close();
  });

  it("allows CORS only for the configured app origin", async () => {
    const ok = await fetchWorker("/api/rooms", { headers: { Origin: APP_ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");

    const other = await fetchWorker("/api/rooms", { headers: { Origin: "https://example.com" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight and rejects other methods", async () => {
    const pre = await fetchWorker("/api/rooms", {
      method: "OPTIONS",
      headers: { Origin: APP_ORIGIN },
    });
    expect(pre.status).toBe(204);
    const post = await fetchWorker("/api/rooms", { method: "POST" });
    expect(post.status).toBe(405);
  });
});

describe("GET /ws", () => {
  it("welcomes a visitor", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-01" });
    expect(welcome.t).toBe("welcome");
    await c.close();
  });

  it("answers the heartbeat ping with pong", async () => {
    const { c } = await TestClient.join({ hall: "hall-01" });
    const before = c.frames.length;
    c.send("ping");
    await wait(200);
    expect(c.frames.slice(before)).toContain("pong");
    await c.close();
  });

  it("closes with 4003 for an origin that isn't allowed", async () => {
    for (const origin of ["https://example.com", null]) {
      const headers: Record<string, string> = { Upgrade: "websocket" };
      if (origin) headers.Origin = origin;
      const res = await fetchWorker(`/ws?hall=hall-01&v=${PROTOCOL_VERSION}`, { headers });
      const ws = res.webSocket;
      if (!ws) throw new Error("no socket");
      const closed = new Promise<CloseEvent>((r) => ws.addEventListener("close", r));
      ws.accept();
      expect((await closed).code).toBe(CLOSE_CODES.ORIGIN_NOT_ALLOWED);
    }
  });

  it("closes with 4002 for a protocol version mismatch", async () => {
    for (const v of [String(PROTOCOL_VERSION + 1), "0", ""]) {
      const c = await TestClient.open({ hall: "hall-01", v });
      expect((await c.closed).code).toBe(CLOSE_CODES.VERSION_MISMATCH);
    }
  });

  it("closes with 4004 when every instance of the hall is full", async () => {
    const d = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
    for (let i = 1; i <= INSTANCES_PER_HALL; i++) await d.report("hall-14", i, INSTANCE_CAPACITY);
    const c = await TestClient.open({ hall: "hall-14" });
    expect((await c.closed).code).toBe(CLOSE_CODES.HALL_FULL);
    for (let i = 1; i <= INSTANCES_PER_HALL; i++) await d.report("hall-14", i, 0);
  });

  it("rejects an unknown hall before upgrading", async () => {
    const res = await fetchWorker(`/ws?hall=hall-99&v=${PROTOCOL_VERSION}`, {
      headers: { Upgrade: "websocket", Origin: APP_ORIGIN },
    });
    expect(res.status).toBe(400);
  });

  it("requires a WebSocket upgrade", async () => {
    const res = await fetchWorker(`/ws?hall=hall-01&v=${PROTOCOL_VERSION}`);
    expect(res.status).toBe(426);
  });

  it("checks the origin before the version", async () => {
    const res = await fetchWorker("/ws?hall=hall-01&v=99", {
      headers: { Upgrade: "websocket", Origin: "https://example.com" },
    });
    const ws = res.webSocket;
    if (!ws) throw new Error("no socket");
    const closed = new Promise<CloseEvent>((r) => ws.addEventListener("close", r));
    ws.accept();
    expect((await closed).code).toBe(CLOSE_CODES.ORIGIN_NOT_ALLOWED);
  });

  it("completes a close the client starts, with the client's code", async () => {
    const { c } = await TestClient.join({ hall: "hall-01" });
    expect((await c.close(CLOSE_CODES.NORMAL)).code).toBe(CLOSE_CODES.NORMAL);
  });
});

describe("other routes", () => {
  it("returns 404 for anything else", async () => {
    expect((await fetchWorker("/")).status).toBe(404);
    expect((await fetchWorker("/api/beacon", { method: "POST" })).status).toBe(404);
  });

  it("serves load-test stats locally (DEV_STATS)", async () => {
    const res = await fetchWorker("/api/dev/stats?room=hall-01%231");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sockets: expect.any(Number) as unknown });
    expect((await fetchWorker("/api/dev/stats?room=nope")).status).toBe(400);
  });
});
