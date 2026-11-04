/**
 * Browser storage helpers. Every access is wrapped in try/catch so the temple works
 * when storage is blocked or full (spec 09 § Browser storage keys). Keys are prefixed "sannidhi:".
 */

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the preference lasts for this page only.
  }
}
