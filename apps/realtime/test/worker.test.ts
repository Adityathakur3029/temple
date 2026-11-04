import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  CLOSE_CODES,
  HALL_COUNT,
  INSTANCE_CAPACITY,
  INSTANCES_PER_HALL,
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  type RoomsResponse,
} from "@sannidhi/protocol";

const APP_ORIGIN = "http://localhost:5173";
const BASE = "http://realtime.test";

function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init));
}

async function openSocket(
  query = `hall=hall-03&v=${PROTOCOL_VERSION}`,
  origin: string | null = APP_ORIGIN,
): Promise<WebSocket> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (origin !== null) headers.Origin = origin;
  const res = await fetchWorker(`/ws?${query}`, { headers });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("No WebSocket on the response");
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener("message", (e) => resolve(String(e.data)), { once: true });
  });
}

function nextClose(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    ws.addEventListener("close", resolve, { once: true });
  });
}

describe("GET /api/rooms", () => {
  it("returns 20 empty halls in the spec 04 shape", async () => {
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
      count: 0,
      capacity: INSTANCE_CAPACITY * INSTANCES_PER_HALL,
      instances: 0,
    });
    expect(body.halls[19]?.id).toBe("hall-20");
    expect(body.today).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown,
      diyas: 0,
      malas: 0,
      parikramas: 0,
      visits: 0,
    });
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
  it("echoes text frames", async () => {
    const ws = await openSocket();
    const reply = nextMessage(ws);
    ws.send('{"t":"bell","bell":"gate"}');
    expect(await reply).toBe('{"t":"bell","bell":"gate"}');
    ws.close(CLOSE_CODES.NORMAL);
  });

  it("answers the heartbeat ping with pong", async () => {
    const ws = await openSocket();
    const reply = nextMessage(ws);
    ws.send("ping");
    expect(await reply).toBe("pong");
    ws.close(CLOSE_CODES.NORMAL);
  });

  it("drops frames over MAX_CLIENT_MESSAGE_BYTES", async () => {
    const ws = await openSocket();
    const reply = nextMessage(ws);
    ws.send("x".repeat(MAX_CLIENT_MESSAGE_BYTES + 1));
    ws.send("small");
    expect(await reply).toBe("small");
    ws.close(CLOSE_CODES.NORMAL);
  });

  it("closes with 4003 for an origin that isn't allowed", async () => {
    for (const origin of ["https://example.com", null]) {
      const ws = await openSocket(`hall=hall-01&v=${PROTOCOL_VERSION}`, origin);
      expect((await nextClose(ws)).code).toBe(CLOSE_CODES.ORIGIN_NOT_ALLOWED);
    }
  });

  it("closes with 4002 for a protocol version mismatch", async () => {
    for (const v of [String(PROTOCOL_VERSION + 1), "0", ""]) {
      const ws = await openSocket(`hall=hall-01&v=${v}`);
      expect((await nextClose(ws)).code).toBe(CLOSE_CODES.VERSION_MISMATCH);
    }
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
});

it("returns 404 for anything else", async () => {
  expect((await fetchWorker("/")).status).toBe(404);
  expect((await fetchWorker("/api/beacon", { method: "POST" })).status).toBe(404);
});

describe("GET /ws edge cases", () => {
  it("closes with 4002 when v is missing", async () => {
    const ws = await openSocket("hall=hall-01");
    expect((await nextClose(ws)).code).toBe(CLOSE_CODES.VERSION_MISMATCH);
  });

  it("checks the origin before the version", async () => {
    const ws = await openSocket("hall=hall-01&v=99", "https://example.com");
    expect((await nextClose(ws)).code).toBe(CLOSE_CODES.ORIGIN_NOT_ALLOWED);
  });

  it("drops binary frames", async () => {
    const ws = await openSocket();
    const reply = nextMessage(ws);
    ws.send(new Uint8Array([1, 2, 3]));
    ws.send("after");
    expect(await reply).toBe("after");
    ws.close(CLOSE_CODES.NORMAL);
  });

  it("completes a close the client starts, with the client's code", async () => {
    const ws = await openSocket();
    const closed = nextClose(ws);
    ws.close(CLOSE_CODES.NORMAL, "leave");
    expect((await closed).code).toBe(CLOSE_CODES.NORMAL);
  });
});
