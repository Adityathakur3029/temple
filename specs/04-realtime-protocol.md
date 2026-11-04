# 04 — Realtime protocol

## Purpose

How browsers and the realtime server talk: halls and instances, the room list, the WebSocket handshake, every message, limits, reconnects, clock sync and versioning.

All types and constants here MUST exist in `packages/protocol` with the same names. Client and server import them from there. This document and that package change together.

## Halls and instances

- There are `HALL_COUNT` halls, with ids `hall-01` … `hall-20`, shown as "Hall 1" / "कक्ष 1".
- Each hall has up to `INSTANCES_PER_HALL` instances, numbered 1 … `INSTANCES_PER_HALL`. Each instance is one Durable Object holding up to `INSTANCE_CAPACITY` visitors.
- **Instance choice** (server-side): send the visitor to the lowest-numbered instance with at least 2 free places, so visitors are grouped together rather than spread thin. Open the next instance only when all open ones are full. The RoomDO has the final say. If it is full when the socket arrives, it closes with `4001` and the client asks again.
- The visitor never picks an instance. They may pick a **hall** from the hall list.

## Room list: `GET /api/rooms`

Response `200 application/json`, `cache-control: no-store`, CORS limited to the app origins:

```ts
interface RoomsResponse {
  v: 1;                            // always PROTOCOL_VERSION
  serverTime: number;              // ms since epoch
  halls: Array<{
    id: HallId;                    // "hall-01"
    number: number;                // 1
    count: number;                 // visitors across instances
    capacity: number;              // INSTANCE_CAPACITY * INSTANCES_PER_HALL
    instances: number;             // currently open
    checkedAt: number;             // when the count was last reported
  }>;
  today: TodayCounters;            // see Counters
}
```

The client picks the default hall like this:
1. If the visitor is resuming within `RESUME_WINDOW_MS`, use their last hall.
2. Otherwise, the fullest hall that is under 90% capacity.
3. If every hall is over 90%, `hall-01`.

## WebSocket: `GET /ws`

```
wss://<realtime-host>/ws?hall=hall-03&v=1[&resume=<token>][&lite=1]
```

| Param | Meaning |
|---|---|
| `hall` | Required. A valid `HallId` |
| `v` | Required. `PROTOCOL_VERSION`. A mismatch closes with `4002` |
| `resume` | Optional resume token from a previous `welcome`, valid for `RESUME_WINDOW_MS` |
| `lite` | Optional. The server sends deltas at `LITE_TICK_HZ` instead of `TICK_HZ` |

The Worker checks `Origin` against the allow-list (spec 05) and closes with `4003` if it doesn't match. It routes to the instance encoded in a valid resume token, or to the chosen instance.

Text frames carry JSON. Every message is an object with a `t` (type) field. The literal text frames `ping`/`pong` are used for heartbeat (see below) and are not JSON.

## Shared types

```ts
type HallId = `hall-${string}`;              // validated against HALL_IDS
type VisitorId = string;                     // short, per instance, e.g. "k3"
type Pose = "stand" | "walk" | "sit" | "pranam" | "japa" | "offer";
const POSES: Pose[] = ["stand", "walk", "sit", "pranam", "japa", "offer"]; // index used in deltas
type BellId = "gate" | `path-${1|2|3|4|5|6|7|8}` | "mandapa-n" | "mandapa-s";
type Gesture = "namaste" | "pranam" | "aarti" | "prasad";

interface Visitor {                          // profile, sent once on join
  id: VisitorId;
  name: { key: string; n: number };          // key into the curated name list (spec 05), e.g. {key:"deodar", n:214}
  shawl: number;                             // 0..7 palette index
  body: 0 | 1;                               // body variant
  joinedAt: number;
}

// Compact per-visitor state used in snapshots and deltas:
// [id, x, z, yaw, poseIndex, mat]   mat = -1 when not seated
type StateTuple = [VisitorId, number, number, number, number, number];

interface Lamp { slot: number; litAt: number; expiresAt: number; mine?: true }

interface TodayCounters { date: string; diyas: number; malas: number; parikramas: number; visits: number }
```

Positions are rounded to 0.01 m and yaw to 0.01 rad by the sender. Coordinates and yaw follow [spec 02](02-temple-world.md#purpose): yaw 0 faces east (`+z`) and yaw π/2 faces north (`+x`). Walkable areas and sacred zones live in `world.ts`.

The order of `POSES` is part of the wire format, because `poseIndex` in `StateTuple` indexes it. Only append to it. Reordering or removing a pose is a breaking change.

The same holds for two lists in `world.ts`: `mat` (in `StateTuple`, `sit` and `sit.ok`) indexes `MATS`, and `spot` (in `diya.turn`) indexes `DIYA_SPOT_POSITIONS`. Their order is fixed in [spec 02 § Greybox details](02-temple-world.md#greybox-details); changing it is a breaking change.

## Client → server messages

| `t` | Fields | Purpose | Rate limit |
|---|---|---|---|
| `pos` | `x, z, yaw, pose: Pose` | Own position and pose; sent only when changed | `POS_MAX_HZ` (bucket burst 20) |
| `gesture` | `g: Gesture` | Namaste, pranam, take aarti, prasad | 1 per `GESTURE_COOLDOWN_MS` |
| `bell` | `bell: BellId` | Ring a bell in reach | 1 per `BELL_COOLDOWN_MS` |
| `sit` | `req, mat?` | Request a mat (nearest if omitted) | 1 per 1 s |
| `stand` | — | Leave the mat | 1 per 1 s |
| `diya.request` | `req` | Ask for a spot at the deepa stand | 1 per 1 s |
| `diya.light` | `req` | Light the diya after arriving at the spot | 1 per 1 s |
| `diya.cancel` | — | Leave the diya queue or spot | 1 per 1 s |
| `jal.request` | `req, kind: "water" \| "bilva"` | Ask for the threshold spot | 1 per 1 s |
| `jal.done` | `req` | Finished pouring/offering | 1 per 1 s |
| `jal.cancel` | — | Leave the jal queue or spot | 1 per 1 s |
| `japa.mala` | — | Completed one mala of 108 | 1 per `JAPA_MALA_MIN_MS` |
| `time` | `c` (client ms) | Clock-sync sample | 1 per 2 s |
| `leave` | — | Leaving on purpose; frees mat and queues immediately | once |

`req` is a client-chosen integer, echoed in the reply. Every message not in this table, or failing validation, counts as a strike.

## Server → client messages

| `t` | Fields | When |
|---|---|---|
| `welcome` | `v, you: Visitor, hall, instance, resume, serverTime, snapshot` | After the socket is accepted |
| `delta` | `rev, at, join?: Visitor[], up?: StateTuple[], gone?: VisitorId[]` | At most `TICK_HZ` (or `LITE_TICK_HZ`), only when something changed |
| `event` | `from, kind: "namaste"\|"pranam"\|"bell"\|"jal"\|"bilva"\|"aarti"\|"prasad", bell?` | Someone did a visible action |
| `correct` | `x, z` | Your last position was not allowed. Snap or ease there |
| `sit.ok` / `sit.no` | `req, mat` / `req` | Mat answer |
| `diya.queue` | `pos` | Your place in the diya queue (0 = next) |
| `diya.turn` | `req, spot, until` | Walk to `spot` and light before `until` |
| `diya.lit` | `lamp: Lamp, by?: VisitorId` | A lamp was lit (`by` included so the lighter's avatar can play the end of the animation) |
| `diya.out` | `slot` | A lamp burned out |
| `diya.no` | `req, why: "has-lamp"\|"stand-full"\|"busy"\|"not-near", nextFreeAt?` | Request refused |
| `jal.queue` / `jal.turn` / `jal.no` | `pos` / `req, until` / `req, why: "cooldown" \| "busy" \| "not-near"` | Same pattern as the diya |
| `pradakshina.done` | `n` | You completed round `n` this visit |
| `counters` | `today: TodayCounters` | On join and every `COUNTERS_PUSH_MS` |
| `time` | `c, s` | Reply to a clock-sync sample (`s` = server ms) |
| `error` | `code: "rate_limited" \| "bad_message", msg?` | Non-fatal problem |

**Snapshot** (inside `welcome`):

```ts
interface Snapshot {
  rev: number;
  visitors: Visitor[];
  states: StateTuple[];
  lamps: Lamp[];
  queues: { diya: number; jal: number };      // lengths only
  today: TodayCounters;
}
```

Privacy: no message ever contains an IP address, user agent, device data, or per-person ritual totals other than your own `pradakshina.done`.

## Close codes

| Code | Name (`CLOSE_CODES`) | Meaning | Client behaviour |
|---|---|---|---|
| 1000 | `NORMAL` | Normal close (leave) | Nothing |
| 1001 | `GOING_AWAY` | Server going away (deploy, eviction) | Reconnect with resume token |
| 4001 | `INSTANCE_FULL` | Instance full | Reconnect immediately (server picks another instance) |
| 4002 | `VERSION_MISMATCH` | Protocol version mismatch | Stop. Show "A new version is ready — refresh" |
| 4003 | `ORIGIN_NOT_ALLOWED` | Origin not allowed | Stop. Show a generic error |
| 4008 | `TOO_MANY_STRIKES` | Too many strikes | Wait 60 s before reconnecting |
| 4010 | `RESUME_INVALID` | Resume token invalid or expired | Reconnect without the token |
| 4011 | `IDLE_TIMEOUT` | Idle timeout (no traffic) | Reconnect only on visitor activity |

## Connection lifecycle

1. **Connect:** with the resume token if one is younger than `RESUME_WINDOW_MS`.
2. **Welcome:**
   - Store `resume` in `sessionStorage` (`sannidhi:resume-v1`).
   - Apply the snapshot.
   - Send 3 `time` samples 500 ms apart.
3. **Steady state:**
   - Send `pos` only on change, at most `POS_MAX_HZ`.
   - Interpolate remote avatars `INTERP_DELAY_MS` behind server time.
4. **Heartbeat:**
   - If the client has sent nothing for `HEARTBEAT_MS`, it sends the text frame `ping`. The server's auto-response replies `pong` without waking the Durable Object.
   - The server closes sockets with no traffic (including pings) for `SERVER_IDLE_TIMEOUT_MS` (`4011`).
5. **Resume:** on reconnect within the window with a valid token, the server restores the same `VisitorId`, name, mat and queue places. Expired tokens get `4010`.
6. **Reconnect back-off:**
   - Delay = min(`RECONNECT_MAX_MS`, `RECONNECT_BASE_MS` × 2^attempt) + random(0, `RECONNECT_JITTER_MS`).
   - Reset after 30 s connected.
   - Also reconnect promptly on the `online` event and when the tab becomes visible.
7. **Leave:** send `leave` and close with 1000.

## Clock sync

- Each `time` sample gives round-trip `rtt = now − c` and offset `off = s − (c + rtt / 2)`.
- Keep the sample with the lowest RTT out of the last 5.
- Resample every 5 minutes and after each reconnect.
- `serverNow() = Date.now() + off`. The aarti player and lamp timers use `serverNow()`, never raw `Date.now()`.

## Versioning

- `PROTOCOL_VERSION` is an integer.
- **Additive** changes (a new optional field, a new message the old client can ignore) don't bump it.
- **Breaking** changes (removed or renamed field, changed meaning or units, new required message) bump it.
- When deploying a bump, the Worker deploys first. Old clients get `4002` and are asked to refresh (see the `release` skill).

## Future: binary deltas (v2)

If measured average downstream traffic exceeds the data budget in [10](10-performance.md), add a binary `delta` frame of our own design:
- a small header (magic, version, revision, server time, counts);
- then fixed-size records using `Int16` positions in centimetres within the world bounds and an `Int16` yaw.

Design and document it here before implementing. Don't base it on any other product's format.

## Constants

| Name | Value | Notes |
|---|---|---|
| `PROTOCOL_VERSION` | 1 | |
| `HALL_COUNT` | 20 | `HALL_IDS` = `hall-01` … `hall-20` |
| `INSTANCES_PER_HALL` | 8 | |
| `INSTANCE_CAPACITY` | 50 | Set for low-end phones; see spec 10 |
| `TICK_HZ` | 10 | Max delta rate |
| `LITE_TICK_HZ` | 4 | For `lite=1` clients |
| `POS_MAX_HZ` | 10 | Client `pos` send rate cap |
| `INTERP_DELAY_MS` | 150 | Remote avatar render delay |
| `MAX_CLIENT_MESSAGE_BYTES` | 1024 | Larger frames are dropped and strike |
| `WALK_SPEED_MPS` | 1.3 | Client walking speed |
| `SPEED_LIMIT_MPS` | 2.2 | Server tolerance before `correct` |
| `GESTURE_COOLDOWN_MS` | 1500 | |
| `BELL_REACH_M` | 2.0 | Client shows the button inside this distance; the server allows +1 m |
| `BELL_COOLDOWN_MS` | 3000 | Per visitor |
| `BELL_MAX_PER_SEC` | 2 | Per bell, across all visitors |
| `JAPA_MALA_MIN_MS` | 60000 | Minimum time between counted malas |
| `PRADAKSHINA_MAX_MS` | 600000 | A round must finish within 10 min |
| `PRADAKSHINA_MODE` | `"half-somasutra"` | or `"full"`; see spec 02 |
| `DIYA_SPOTS` | 4 | Standing spots at the deepa stand |
| `DIYA_SLOTS` | 108 | Lamps on the stand per instance |
| `DIYA_BURN_MS` | 600000 | 10 min |
| `DIYA_TURN_TIMEOUT_MS` | 30000 | Time to reach the spot and light |
| `JAL_COOLDOWN_MS` | 120000 | Per visitor |
| `JAL_TURN_TIMEOUT_MS` | 30000 | |
| `MAT_COUNT` | 40 | Two blocks of 20 |
| `AARTI_TIMES_IST` | `["06:00", "19:00"]` | |
| `AARTI_BANNER_LEAD_MS` | 900000 | Banner 15 min before |
| `AARTI_BELLS_LEAD_MS` | 120000 | Bells and "Go to the mandapa" 2 min before |
| `AARTI_PLATE_MS` | 600000 | Take-aarti and prasad window after the end |
| `COUNTERS_PUSH_MS` | 60000 | |
| `RESUME_WINDOW_MS` | 60000 | |
| `HEARTBEAT_MS` | 25000 | |
| `SERVER_IDLE_TIMEOUT_MS` | 75000 | |
| `RECONNECT_BASE_MS` | 800 | |
| `RECONNECT_MAX_MS` | 15000 | |
| `RECONNECT_JITTER_MS` | 400 | |
| `STRIKE_LIMIT` | 20 | Strikes within 60 s before close `4008` |
| `IDLE_SLEEP_MS` | 180000 | Client goes to rest after 3 min without input (spec 10) |
| `VIEW_CHECKPOINT_MS` | 1800000 | Local view restore window (spec 10) |

## Acceptance criteria

- Every message and constant in this document exists in `packages/protocol` under the same name, and a unit test asserts the constant values.
- The server validates every inbound message with the package's guards. Fuzz tests with random JSON never crash a RoomDO.
- Two clients with device clocks 2 minutes apart compute `serverNow()` within 50 ms of each other on a local network.
- A client reconnecting within 60 s keeps its `VisitorId`, mat and queue place. After 60 s it joins as a new visitor.
- Old-version clients receive `4002` and show the refresh message.

## Open decisions

1. **Compression.** Use WebSocket permessage-deflate if Cloudflare Workers negotiates it for our setup. Measure in M2 before designing binary deltas.
2. **Interest management.** Not needed at 50 per instance. Revisit if capacity grows.
