import { DurableObject } from "cloudflare:workers";
import { CLOSE_CODES, HEARTBEAT_PING, HEARTBEAT_PONG, isOversized } from "@sannidhi/protocol";

/**
 * One hall instance, named "hall-03#2" (spec 05 § RoomDO).
 *
 * M0: accepts hibernatable WebSockets and echoes text frames up to
 * MAX_CLIENT_MESSAGE_BYTES. Presence, movement and rituals replace the echo in M2/M3.
 */
export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat pings are answered by the runtime without waking the object (spec 05 § Heartbeat).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
  }

  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || isOversized(message)) return;
    ws.send(message);
  }

  /** Complete the closing handshake so the client sees its own code, not 1006. */
  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // 1005 and 1006 are reserved: they describe a close but can't be sent in one.
    const reply = code === 1005 || code === 1006 ? CLOSE_CODES.NORMAL : code;
    try {
      ws.close(reply, reason);
    } catch {
      // The runtime may already have answered the close; nothing left to do.
    }
  }

  override webSocketError(ws: WebSocket): void {
    try {
      ws.close(CLOSE_CODES.NORMAL);
    } catch {
      // Already closed.
    }
  }
}
