/**
 * Every number the client and server share. Mirrors the Constants table in
 * specs/04-realtime-protocol.md. Change both together; test/constants.test.ts
 * reads the spec table and fails if they drift apart.
 */

/** Integer. Bump on any breaking message change (spec 04 § Versioning). */
export const PROTOCOL_VERSION = 1;

export const HALL_COUNT = 20;
export const INSTANCES_PER_HALL = 8;
/** Visitors per instance. Set for low-end phones (spec 10). */
export const INSTANCE_CAPACITY = 50;

/** Max server delta rate. */
export const TICK_HZ = 10;
/** Delta rate for `lite=1` clients. */
export const LITE_TICK_HZ = 4;
/** Client `pos` send rate cap. */
export const POS_MAX_HZ = 10;
/** Remote avatars render this far behind server time. */
export const INTERP_DELAY_MS = 150;
/** Larger client frames are dropped and count as a strike. */
export const MAX_CLIENT_MESSAGE_BYTES = 1024;

/** Client walking speed. There is no running. */
export const WALK_SPEED_MPS = 1.3;
/** Server tolerance before it sends `correct`. */
export const SPEED_LIMIT_MPS = 2.2;

export const GESTURE_COOLDOWN_MS = 1500;
/** The client shows the bell button inside this distance; the server allows +1 m. */
export const BELL_REACH_M = 2.0;
/** Per visitor. */
export const BELL_COOLDOWN_MS = 3000;
/** Per bell, across all visitors. */
export const BELL_MAX_PER_SEC = 2;

/** Minimum time between counted malas. */
export const JAPA_MALA_MIN_MS = 60000;

/** A round must finish within 10 min. */
export const PRADAKSHINA_MAX_MS = 600000;
export type PradakshinaMode = "half-somasutra" | "full";
/** Default follows spec 02; check with advisor (spec 08). */
export const PRADAKSHINA_MODE: PradakshinaMode = "half-somasutra";

/** Standing spots at the deepa stand. */
export const DIYA_SPOTS = 4;
/** Lamps on the stand per instance. */
export const DIYA_SLOTS = 108;
/** A diya burns for 10 min. */
export const DIYA_BURN_MS = 600000;
/** Time to reach the spot and light. */
export const DIYA_TURN_TIMEOUT_MS = 30000;

/** Per visitor. */
export const JAL_COOLDOWN_MS = 120000;
export const JAL_TURN_TIMEOUT_MS = 30000;

/** Two blocks of 20. */
export const MAT_COUNT = 40;

/** Local IST wall-clock times, "HH:MM". */
export const AARTI_TIMES_IST = ["06:00", "19:00"] as const;
/** Banner 15 min before. */
export const AARTI_BANNER_LEAD_MS = 900000;
/** Bells and "Go to the mandapa" 2 min before. */
export const AARTI_BELLS_LEAD_MS = 120000;
/** Take-aarti and prasad window after the end. */
export const AARTI_PLATE_MS = 600000;

export const COUNTERS_PUSH_MS = 60000;

export const RESUME_WINDOW_MS = 60000;
export const HEARTBEAT_MS = 25000;
export const SERVER_IDLE_TIMEOUT_MS = 75000;

export const RECONNECT_BASE_MS = 800;
export const RECONNECT_MAX_MS = 15000;
export const RECONNECT_JITTER_MS = 400;

/** Strikes within 60 s before close `4008`. */
export const STRIKE_LIMIT = 20;

/** Client goes to rest after 3 min without input (spec 10). */
export const IDLE_SLEEP_MS = 180000;
/** Local view restore window (spec 10). */
export const VIEW_CHECKPOINT_MS = 1800000;

/** WebSocket close codes (spec 04 § Close codes). */
export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  INSTANCE_FULL: 4001,
  VERSION_MISMATCH: 4002,
  ORIGIN_NOT_ALLOWED: 4003,
  TOO_MANY_STRIKES: 4008,
  RESUME_INVALID: 4010,
  IDLE_TIMEOUT: 4011,
} as const;
export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];
