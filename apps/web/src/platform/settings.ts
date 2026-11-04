/**
 * Visitor settings in localStorage `sannidhi:settings-v1` (spec 09 § Browser storage keys).
 * Unknown or malformed fields fall back to the defaults, so an old or edited value never breaks boot.
 */
import { isTier, type Tier } from "./tier";
import { type KeyValueStore, isRecord, parseJson } from "./storage";

export const SETTINGS_KEY = "sannidhi:settings-v1";

export interface Settings {
  /** Lite mode (spec 07 § Lite mode). */
  lite: boolean;
  /** Picture quality: "auto" picks and adjusts the tier (spec 10); otherwise the visitor's choice. */
  tier: "auto" | Tier;
  /** null follows the system's prefers-reduced-motion. */
  reducedMotion: boolean | null;
  /** The automatic Lite suggestion is shown once; this records that it was. */
  liteSuggested: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  lite: false,
  tier: "auto",
  reducedMotion: null,
  liteSuggested: false,
};

export function parseSettings(raw: string | null): Settings {
  const v = parseJson(raw);
  if (!isRecord(v)) return { ...DEFAULT_SETTINGS };
  return {
    lite: typeof v.lite === "boolean" ? v.lite : DEFAULT_SETTINGS.lite,
    tier: v.tier === "auto" || isTier(v.tier) ? v.tier : DEFAULT_SETTINGS.tier,
    reducedMotion: typeof v.reducedMotion === "boolean" ? v.reducedMotion : null,
    liteSuggested: typeof v.liteSuggested === "boolean" ? v.liteSuggested : false,
  };
}

type Listener = (s: Readonly<Settings>, changed: ReadonlySet<keyof Settings>) => void;

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly store: KeyValueStore) {
    this.value = parseSettings(store.getItem(SETTINGS_KEY));
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    const changed = new Set<keyof Settings>();
    const next = { ...this.value };
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      const value = patch[key];
      if (value !== undefined && next[key] !== value) {
        (next as Record<keyof Settings, unknown>)[key] = value;
        changed.add(key);
      }
    }
    if (changed.size === 0) return;
    this.value = next;
    this.store.setItem(SETTINGS_KEY, JSON.stringify(next));
    for (const fn of this.listeners) fn(next, changed);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
