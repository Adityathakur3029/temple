import { CLOSE_CODES, PROTOCOL_VERSION, isHallId } from "@sannidhi/protocol";
import { isAllowedOrigin } from "./origin";
import { roomName, staticRooms } from "./rooms";

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
      default:
        return new Response("Not found", { status: 404 });
    }
  },
} satisfies ExportedHandler<Env>;

function handleRooms(request: Request, env: Env): Response {
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

  headers.set("content-type", "application/json; charset=utf-8");
  const body = request.method === "HEAD" ? null : JSON.stringify(staticRooms(Date.now()));
  return new Response(body, { status: 200, headers });
}

function handleWebSocket(request: Request, url: URL, env: Env): Response | Promise<Response> {
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

  // M0: every hall uses instance 1. In M2 the DirectoryDO picks the instance and
  // a resume token can name one (spec 05 § Routes).
  const stub = env.ROOM.get(env.ROOM.idFromName(roomName(hall, 1)), {
    locationHint: LOCATION_HINT,
  });
  return stub.fetch(request);
}

/** Accept the upgrade only to close it with a protocol close code the client can act on (spec 04). */
function closedSocket(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  console.log(JSON.stringify({ event: "ws_rejected", code }));
  return new Response(null, { status: 101, webSocket: client });
}
