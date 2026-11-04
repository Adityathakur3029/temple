/**
 * One rendering tab (spec 10 § Background, tabs and idle). The most recently focused or used tab
 * claims rendering; the others stop their frame loop and show the rest overlay.
 * Tabs talk over BroadcastChannel; the `sannidhi:render-owner-v1` localStorage key and its
 * `storage` events are the fallback where BroadcastChannel is missing.
 */
import { type KeyValueStore, isRecord, parseJson } from "./storage";

export const RENDER_OWNER_KEY = "sannidhi:render-owner-v1";
const CHANNEL_NAME = "sannidhi:render-owner-v1";

interface Claim {
  t: "claim";
  id: string;
  at: number;
}

function isClaim(v: unknown): v is Claim {
  return isRecord(v) && v.t === "claim" && typeof v.id === "string" && typeof v.at === "number";
}

/** The part of BroadcastChannel this needs, so tests can connect fakes. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface RenderOwnerOptions {
  id?: string;
  channel: ChannelLike | null;
  store: KeyValueStore;
  now?: () => number;
  onChange: (owner: boolean) => void;
}

export class RenderOwner {
  readonly id: string;
  private owner = false;
  private lastClaim: Claim | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: RenderOwnerOptions) {
    this.id = opts.id ?? Math.random().toString(36).slice(2, 10);
    this.now = opts.now ?? Date.now;
    if (opts.channel) opts.channel.onmessage = (e) => this.receive(e.data);
  }

  get isOwner(): boolean {
    return this.owner;
  }

  /** Take over rendering and tell the other tabs. */
  claim(): void {
    const claim: Claim = { t: "claim", id: this.id, at: this.now() };
    this.lastClaim = claim;
    this.opts.channel?.postMessage(claim);
    this.opts.store.setItem(RENDER_OWNER_KEY, JSON.stringify(claim));
    this.set(true);
  }

  /** A `storage` event for RENDER_OWNER_KEY (fired in the other tabs only). */
  storageChanged(newValue: string | null): void {
    this.receive(parseJson(newValue));
  }

  dispose(): void {
    if (this.opts.channel) {
      this.opts.channel.onmessage = null;
      this.opts.channel.close();
    }
  }

  private receive(data: unknown): void {
    if (!isClaim(data) || data.id === this.id) return;
    // A claim older than our own latest one is stale (two tabs claimed at once). Ties go to the
    // larger id, which both tabs agree on.
    const mine = this.lastClaim;
    if (mine && (data.at < mine.at || (data.at === mine.at && data.id < mine.id))) return;
    this.set(false);
  }

  private set(owner: boolean): void {
    if (owner === this.owner) return;
    this.owner = owner;
    this.opts.onChange(owner);
  }
}

/** BroadcastChannel where the browser has one. */
export function openChannel(): ChannelLike | null {
  try {
    if (typeof BroadcastChannel !== "function") return null;
    const bc = new BroadcastChannel(CHANNEL_NAME);
    const channel: ChannelLike = {
      postMessage: (m) => bc.postMessage(m),
      onmessage: null,
      close: () => bc.close(),
    };
    bc.onmessage = (e: MessageEvent<unknown>) => channel.onmessage?.({ data: e.data });
    return channel;
  } catch {
    return null;
  }
}
