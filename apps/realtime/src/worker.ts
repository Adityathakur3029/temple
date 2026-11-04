import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  isHallId,
  parseResumeToken,
  type RoomsResponse,
} from "@sannidhi/protocol";
import type { DirectoryDO, PickResult } from "./directory";
import { isAllowedOrigin } from "./origin";
import { ROOM_HEADER, parseRoomName } from "./room";
import { ROOMS_CACHE_MS, roomName, roomsCache } from "./rooms";

export { DirectoryDO } from "./directory";
export { RoomDO } from "./room";

/** Most visitors are in India (spec 01, open decision 2). */
const LOCATION_HINT = "apac";

export default {
  fetch(request, env): Response | Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/api/rooms":
        return handleRooms(request, env);
      case "/ws":
        return handleWebSocket(request, url, env);
      case "/api/dev/stats":
        // Load-test numbers (spec 12), only where wrangler.jsonc sets DEV_STATS (local dev).
        if (env.DEV_STATS === "1") return handleStats(url, env);
        return new Response("Not found", { status: 404 });
      default:
        return new Response("Not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;

function directory(env: Env): DurableObjectStub<DirectoryDO> {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"), {
    locationHint: LOCATION_HINT,
  });
}

async function handleRooms(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = new Headers({ "cache-control": "no-store", vary: "Origin" });
  if (isAllowedOrigin(origin, env.ALLOWED_ORIGINS) && origin !== null) {
    headers.set("access-control-allow-origin", origin);
  }

  if (request.method === "OPTIONS") {
    headers.set("access-control-allow-methods", "GET");
    headers.set("access-control-max-age", "86400");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("allow", "GET, HEAD, OPTIONS");
    return new Response("Method not allowed", { status: 405, headers });
  }

  const now = Date.now();
  let body = roomsCache.body;
  if (body === null || now - roomsCache.at > ROOMS_CACHE_MS) {
    const rooms: RoomsResponse = await directory(env).rooms();
    body = JSON.stringify(rooms);
    roomsCache.at = now;
    roomsCache.body = body;
  }
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

async function handleWebSocket(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  if (!isAllowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
    return closedSocket(CLOSE_CODES.ORIGIN_NOT_ALLOWED, "origin");
  }
  if (url.searchParams.get("v") !== String(PROTOCOL_VERSION)) {
    return closedSocket(CLOSE_CODES.VERSION_MISMATCH, "version");
  }
  const hall = url.searchParams.get("hall");
  if (!isHallId(hall)) {
    return new Response("Unknown hall", { status: 400 });
  }

  // A resume token names its instance; otherwise the DirectoryDO picks one (spec 05 § Routes).
  let instance: number;
  const token = url.searchParams.get("resume");
  if (token !== null) {
    const parsed = parseResumeToken(token);
    if (!parsed || parsed.hall !== hall) return closedSocket(CLOSE_CODES.RESUME_INVALID, "resume");
    instance = parsed.instance;
  } else {
    let picked: PickResult;
    try {
      picked = await directory(env).pick(hall);
    } catch {
      // The client resumes with back-off, as for any unexpected close (spec 04).
      return closedSocket(CLOSE_CODES.SERVER_ERROR, "directory");
    }
    if ("full" in picked) return closedSocket(CLOSE_CODES.HALL_FULL, "hall full");
    instance = picked.instance;
  }

  const name = roomName(hall, instance);
  const headers = new Headers(request.headers);
  // Always set here, so a client can't name a room by sending the header itself.
  headers.set(ROOM_HEADER, name);
  const stub = env.ROOM.get(env.ROOM.idFromName(name), { locationHint: LOCATION_HINT });
  try {
    return await stub.fetch(new Request(request.url, { method: "GET", headers }));
  } catch {
    return closedSocket(CLOSE_CODES.SERVER_ERROR, "room");
  }
}

async function handleStats(url: URL, env: Env): Promise<Response> {
  const named = parseRoomName(url.searchParams.get("room"));
  if (!named) return new Response("room=hall-01#1", { status: 400 });
  const stub = env.ROOM.get(env.ROOM.idFromName(roomName(named.hall, named.instance)));
  return Response.json(await stub.stats());
}

/** Accept the upgrade only to close it with a protocol close code the client can act on (spec 04). */
function closedSocket(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  console.log(JSON.stringify({ event: "ws_rejected", code }));
  return new Response(null, { status: 101, webSocket: client });
}
