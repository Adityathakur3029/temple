/**
 * Small wire helpers shared by client, server and bots (spec 04): rounding, resume tokens and a
 * defensive decoder for server frames.
 */
import { INSTANCES_PER_HALL } from "./constants";
import { SERVER_MESSAGE_TYPES, type HallId, type ServerMessage } from "./messages";
import { isHallId } from "./validate";

/** Positions go on the wire rounded to 0.01 m. */
export function roundCm(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Yaw goes on the wire rounded to 0.01 rad, wrapped to (−π, π]. */
export function roundYaw(v: number): number {
  return Math.round(Math.atan2(Math.sin(v), Math.cos(v)) * 100) / 100;
}

/**
 * `welcome.resume` is "<hall>.<instance>.<128-bit random, base64url>" (spec 05 § Resume).
 * The Worker routes on the hall and instance; the client reads the hall to rejoin it.
 */
export function parseResumeToken(token: string): { hall: HallId; instance: number } | null {
  const m = /^(hall-\d{2})\.(\d)\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const hall = m[1];
  const instance = Number(m[2]);
  if (!isHallId(hall) || instance < 1 || instance > INSTANCES_PER_HALL) return null;
  return { hall, instance };
}

/**
 * Parses a server text frame. Returns null for anything that isn't a JSON object with a known
 * `t`, so a newer server's extra message types are ignored rather than breaking an older client.
 * Field shapes are trusted: the server is ours and validates what it sends.
 */
export function decodeServerMessage(frame: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const t = (value as { t?: unknown }).t;
  return typeof t === "string" && (SERVER_MESSAGE_TYPES as readonly string[]).includes(t)
    ? (value as ServerMessage)
    : null;
}
