/**
 * Where the realtime Worker is (spec 01 § Environments). Set at build time by `VITE_REALTIME_URL`;
 * the deploy script sets it per environment (tools/deploy/target.ts). Local dev uses wrangler dev.
 */
const DEFAULT_REALTIME_URL = "http://localhost:8787";

export function realtimeBase(
  value: string | undefined = import.meta.env.VITE_REALTIME_URL,
): string {
  return (value && value.trim() !== "" ? value.trim() : DEFAULT_REALTIME_URL).replace(/\/+$/, "");
}

/** http(s)://host → ws(s)://host. */
export function socketBase(httpBase: string): string {
  return httpBase.replace(/^http/, "ws");
}
