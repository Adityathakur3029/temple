/** A test WebSocket client that speaks the spec 04 protocol against the Worker in workerd. */
import { exports } from "cloudflare:workers";
import { expect } from "vitest";
import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
  type WelcomeMessage,
} from "@sannidhi/protocol";

export const APP_ORIGIN = "http://localhost:5173";
export const BASE = "http://realtime.test";

export function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init));
}

type Of<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;

export class TestClient {
  readonly frames: string[] = [];
  private readonly queue: ServerMessage[] = [];
  private wake: (() => void) | null = null;
  readonly closed: Promise<CloseEvent>;
  closeEvent: CloseEvent | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const text = String(e.data);
      this.frames.push(text);
      const msg = decodeServerMessage(text);
      if (msg) this.queue.push(msg);
      this.wake?.();
    });
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (e) => {
        this.closeEvent = e;
        this.wake?.();
        resolve(e);
      });
    });
  }

  static async open(
    params: Record<string, string> = {},
    headers: Record<string, string> = {},
  ): Promise<TestClient> {
    const q = new URLSearchParams({ hall: "hall-01", v: String(PROTOCOL_VERSION), ...params });
    const res = await fetchWorker(`/ws?${q.toString()}`, {
      headers: { Upgrade: "websocket", Origin: APP_ORIGIN, ...headers },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error("No WebSocket on the response");
    ws.accept();
    return new TestClient(ws);
  }

  /** Opens a socket and waits for its welcome. */
  static async join(
    params: Record<string, string> = {},
    headers: Record<string, string> = {},
  ): Promise<{ c: TestClient; welcome: WelcomeMessage }> {
    const c = await TestClient.open(params, headers);
    return { c, welcome: await c.next("welcome") };
  }

  send(msg: ClientMessage | string): void {
    this.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  /** The next message of type `t`, skipping (and keeping) others. */
  async next<T extends ServerMessage["t"]>(
    t: T,
    match: (m: Of<T>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Of<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.queue.findIndex((m) => m.t === t && match(m as Of<T>));
      if (i >= 0) return this.queue.splice(i, 1)[0] as Of<T>;
      if (this.closeEvent) throw new Error(`Closed (${this.closeEvent.code}) waiting for ${t}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for ${t}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
  }

  /** True if no message of type `t` arrives within `ms`. */
  async none<T extends ServerMessage["t"]>(
    t: T,
    ms = 400,
    match: (m: Of<T>) => boolean = () => true,
  ): Promise<boolean> {
    try {
      await this.next(t, match, ms);
      return false;
    } catch {
      return true;
    }
  }

  close(code = 1000): Promise<CloseEvent> {
    try {
      this.ws.close(code);
    } catch {
      // Already closed.
    }
    return this.closed;
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
