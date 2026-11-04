/**
 * Browser storage helpers. Every access is wrapped in try/catch so the temple works
 * when storage is blocked or full (spec 09 § Browser storage keys). Keys are prefixed "sannidhi:".
 */

/** The subset of `Storage` the app uses, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A store that never throws: reads fall back to null and failed writes are dropped. */
export function safeStore(open: () => KeyValueStore): KeyValueStore {
  return {
    getItem(key) {
      try {
        return open().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        open().setItem(key, value);
      } catch {
        // Storage unavailable: the value lasts for this page only.
      }
    },
  };
}

export const localStore = safeStore(() => window.localStorage);
export const sessionStore = safeStore(() => window.sessionStorage);

export function readLocal(key: string): string | null {
  return localStore.getItem(key);
}

export function writeLocal(key: string, value: string): void {
  localStore.setItem(key, value);
}

/** Parses JSON, returning undefined for missing or malformed values. */
export function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** In-memory store for tests and for when the browser offers none. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}
