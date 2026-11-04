# 05 — Server

## Purpose

How the realtime backend is built on Cloudflare Workers and Durable Objects: routing, the two Durable Object classes, state that survives hibernation, abuse protection, names, counters and observability.

## Components

| Component | Kind | Responsibility |
|---|---|---|
| `worker.ts` | Worker (stateless) | Routes, origin and CORS checks, instance choice via DirectoryDO, WebSocket upgrade forwarding, beacon intake |
| `RoomDO` | Durable Object, one per hall instance, named `hall-03#2` | Presence, movement validation, rituals (mats, queues, lamps, bells), broadcasts, resume |
| `DirectoryDO` | Durable Object, single, named `directory` | Instance counts per hall, instance choice, temple-wide "today" counters |

Both Durable Object classes use the **SQLite storage backend** (`new_sqlite_classes` in the first migration) and the **WebSocket Hibernation API** (`ctx.acceptWebSocket`).

## Routes

| Route | Handler |
|---|---|
| `GET /api/rooms` | Read from the DirectoryDO. Each Worker isolate keeps the JSON in memory for 3 s to protect the single DirectoryDO from bursts (the Cache API does nothing on `workers.dev` hosts, where staging runs) |
| `GET /ws?hall&v[&resume][&lite]` | Check `Origin` and `v` → parse the resume token (it names its instance) or ask the DirectoryDO to `pick(hall)` → forward the upgrade request to that RoomDO, naming the instance in the `x-sannidhi-room` header. The Worker always sets that header itself, so a client can't choose a room |
| `POST /api/beacon` | Client-only analytics events (spec 09). Body ≤ 256 bytes, event name from an allow-list, written to Workers Analytics Engine |
| `GET /api/dev/stats?room=hall-01#1` | Load-test numbers from one RoomDO: sockets, held places, flush count, and p95 and max flush time. Served only where the `DEV_STATS` var is `"1"`, which is local dev only |
| anything else | 404 |

**Origin allow-list:** the production domain, the staging domain, `http://localhost:5173`. Configured per environment in `wrangler.jsonc` vars, not in code.

## RoomDO

### State

| State | Where it lives | Survives hibernation? |
|---|---|---|
| Connected visitors (profile, last valid position, pose, mat, strikes, lite flag) | WebSocket attachment (`serializeAttachment`, ≤ 2 KB each) | Yes, rebuilt from `ctx.getWebSockets()` on wake |
| Mats taken | Derived from attachments + resume records | Yes |
| Diya and jal queues, current turns | Storage key `queues` (small JSON, written on change) | Yes |
| Lit lamps | Storage `lamp:<slot>` with `expiresAt` | Yes |
| Resume records | Storage `resume:<token>` → `{visitor, place, until}`, written on disconnect. `place` is the position, facing, pose and mat. Queue places join it in M3 | Yes; also survives a DO restart |
| Pradakshina checkpoint progress | Attachment | Yes |
| Pending counter increments | Storage `pending-counters`, flushed to DirectoryDO | Yes |
| Bell rate windows, broadcast timer, token buckets for rate limits, per-IP counts | Memory only | Not needed after wake (a bucket starts full again). From M3, the time of the last counted mala goes in the attachment, so hibernation can't reset `JAPA_MALA_MIN_MS` |

Rule: if losing it on hibernation would change what a visitor sees, it is in an attachment or in storage.

The delta `rev` starts at the wall clock when the object starts, so a new incarnation never repeats an older revision.

### Timers

- **Broadcast flush:**
  - When state changes, schedule a flush in ≤ 100 ms (`setTimeout`), coalescing changes.
  - Lite sockets are tagged (`acceptWebSocket(ws, ["lite"])`) and flushed at most every 250 ms.
  - Nothing changed → nothing is sent, so idle rooms hibernate.
- **One alarm** set to the earliest of:
  - the next lamp expiry;
  - the next queue-turn timeout;
  - the next resume-record expiry;
  - the idle sweep (every 60 s while any sockets exist);
  - the counter flush (10 s after the first pending increment).
- **Idle sweep:** close sockets whose last message and last auto-response (`ctx.getWebSocketAutoResponseTimestamp`) are both older than `SERVER_IDLE_TIMEOUT_MS`, with code `4011`.

### Heartbeat

`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))`, so client pings never wake the object.

### Handling a message

1. Size ≤ `MAX_CLIENT_MESSAGE_BYTES`, else strike.
2. `JSON.parse` in try/catch, else strike.
3. Type guard from `packages/protocol/src/validate.ts`, else strike.
4. Rate limit: a token bucket per visitor per message type (table in spec 04). Over the limit → drop and strike. Don't reply to every drop; send at most one `error {code:"rate_limited"}` per 10 s.
5. Apply the rule for that message (below). Errors inside a handler are caught, logged without visitor data, and never close the socket.
6. When strikes in the last 60 s exceed `STRIKE_LIMIT` → close with `4008`.

### Movement rule (`pos`)

- `dt` is the time since the last accepted position (server clock).
- Accept the new position if all of these hold:
  - the distance is ≤ `SPEED_LIMIT_MPS × dt + 0.5 m`, with `dt` capped at `MOVE_MAX_DT_MS`, so a visitor who stood still for a while can't jump far in one step;
  - the whole step, the straight segment from the last accepted position to the new one, stays inside the walkable area and outside every sacred and blocked zone (`segmentBlocked` in `world.ts`). Checking only the end point would let one long step hop over a thin zone such as the somasutra or the Nandi axis;
  - the pose is a valid transition:
    - `sit` only within 0.3 m of the mat the visitor holds. The server then places them on it exactly, facing the sanctum.
    - `offer` only during a diya or jal turn (M3).
    - A seated visitor stays on the mat until they stand. `sit` or `japa` away from it is refused, and any standing pose gets up and frees the mat, as `stand` does.
- The first `pos` after a welcome may be anywhere walkable, with no speed check. This way a reload with view restore (spec 10) keeps the visitor's place, and so does a visitor who walked on alone while their network was away. It still can't be on a sacred or blocked zone.
- Otherwise reply `correct {x, z}` with the last valid position and keep that.
- Update the pradakshina checkpoint state from accepted positions (spec 03).

### Mats, queues, lamps, bells

These follow the rules in [03 Rituals](03-rituals.md), with constants from [04](04-realtime-protocol.md#constants). Ordering is strictly first-come by server receive time. Ties can't happen inside a single Durable Object.

- **Mats:** `sit.ok` gives the visitor the mat to hold while they walk to it. A mat held by a connected visitor or by a resume record is never given to anyone else. A new `sit` releases the mat held before.
- **Gestures and bells** go out as `event` at once, to everyone in the instance except the visitor who did them (their own client plays it locally).

### Capacity

- When connected visitors plus places held by resume records reach `INSTANCE_CAPACITY`, new sockets get `4001`. A visitor with a valid resume token always fits, because their place was held. An instance that turns someone away reports its count at once.
- The RoomDO reports its count to the DirectoryDO on join and leave (debounced 2 s), and every 30 s while not empty. The count includes places held by resume records, because the room would refuse a newcomer for them. While the DirectoryDO is failing, an empty room retries with back-off up to 60 s.
- The DirectoryDO drops a pick's reservation once a report made at least 1 s after the pick has counted it, so recent joins are not counted twice.

### Resume

- `welcome.resume` is `<hall>.<instance>.<128-bit random, base64url>`.
- The record `resume:<token>` is written at join with `until: null`, and again when the visitor's mat changes. So a place outlives a reset that drops sockets without a close event (a deploy): on start-up, a record whose socket is gone gets `until = now + RESUME_WINDOW_MS`.
- On disconnect (not `leave`) the RoomDO sets `until = now + RESUME_WINDOW_MS`. The visitor's mat and queue places are held until then. After a `leave` or a strike close the record is deleted.
- On reconnect with a token, the record is read and deleted, and the visitor gets the same id and name.
- A token whose socket is still open here (the visitor moved from Wi-Fi to mobile data before this object saw the old socket close) takes that socket over: the old one closes with 1000 and the new one keeps the visitor, place, mat and strikes. A takeover is never refused for the per-IP cap, because it adds no socket.
- An unknown or expired token gets `4010`.

## DirectoryDO

- **Instance table:** `{hall, instance, count, reportedAt}`, kept in memory. Every open RoomDO reports within 30 s, so a restarted directory is whole again within one interval. Rows older than 90 s count as empty.
- **`pick(hall)`:**
  - Returns the lowest instance with at least 2 free places, counting **pending reservations**. Each pick reserves a place for 10 s.
  - If every open instance is full, it opens the next one (up to `INSTANCES_PER_HALL`).
  - If all instances are full, it returns `full`, and the Worker closes the socket with `4004`. The client then suggests another hall.
- **Room list:** builds the `RoomsResponse` (spec 04) from the table.
- **Today counters:**
  - Stored per IST date (`today:2026-11-03`), with increments batched from RoomDOs.
  - Kept for 7 days and then deleted.
  - The date rolls over at 00:00 IST, computed with `schedule.ts`.
- **Distinct visits:** counted as new `welcome` messages that didn't use a resume token. No visitor identifier is stored.

## Names

- Server-assigned on join: a `key` from the curated list in `packages/protocol/src/names.ts`, plus a number 100–999 unique within the instance.
- Some numbers are never given (`NAME_NUMBERS_EXCLUDED`): 108 (the japa count, and a monastic title), 420 (Hindi slang for a cheat), and 666 and 786 (numbers with a religious meaning).
- A word is also left out if a number turns it into something else ("धारा 420" reads as a legal section) or if it reads as comic.
- Each key has English and Hindi labels, for example `deodar` → "Deodar" / "देवदार". Clients render the label in the viewer's language.
- The list uses Himalayan nature words: trees, flowers, birds, weather, landforms. For example deodar, buransh, bhojpatra, kafal, monal, koel, bulbul, megh, jharna, pahad, nadi, oak, pine, fern, cloud, mist, dawn, snow.
- It **must not** contain:
  - names of deities, saints, sacred rivers or sacred places;
  - caste or community surnames;
  - political, regional or brand words.
- The list is reviewed by the cultural reviewer.

## Abuse protection

There's no free text, so the remaining risks are connection floods, message spam and griefing through positions or queues.

- **Cloudflare rate-limiting rules (WAF):**
  - `/ws` upgrades: 30 per minute per IP;
  - `/api/*`: 120 per minute per IP.
  - Limits are generous because many Indian mobile users share IPs behind carrier NAT.
- **Per-instance cap** of 15 concurrent sockets per IP:
  - Set by `PER_IP_SOCKET_CAP` in `wrangler.jsonc`: 15 in production, and 0 (no cap) locally and on staging, so a load test can run 50 bots from one machine.
  - The count is kept in memory only, keyed by a hash of the IP with a random salt that changes daily. It is never stored or logged. After hibernation the counts start again from zero; the WAF rule on `/ws` still limits upgrades.
  - Over the cap, the socket closes with `4008`, so the client waits before trying again.
- **Message validation**, rate limits and strikes as above.
- **Queue fairness:** turn timeouts, one lamp per visitor, and queue entries freed on disconnect after the resume window.
- **Movement:** server-side speed and zone checks prevent teleporting into sacred zones or onto ritual spots.

## Observability

- **Structured logs** (Workers Logs):
  - Fields: `event`, `hall`, `instance`, `code`, `ms`.
  - Never logged: IPs, user agents, tokens or visitor names.
- **Analytics Engine dataset** `sannidhi_metrics`:
  - concurrent visitors per hall (sampled every 30 s);
  - connects, closes by code, strikes, `correct` count, broadcast flush time (p95), DO exceptions.
- **Alerts:**
  - DO exception rate > 1%;
  - closes with `4008` above baseline;
  - `GET /api/rooms` error rate > 2%.

## Acceptance criteria

- Durable Object tests (`@cloudflare/vitest-pool-workers`) cover:
  - join/leave;
  - capacity `4001`;
  - resume within and after the window;
  - each ritual's success and rejection paths;
  - movement correction into each sacred zone;
  - strike close `4008`;
  - state rebuild after a simulated hibernation (drop memory, rebuild from attachments and storage).
- A lamp lit before the RoomDO restarts is still present, with the same expiry, after restart.
- With 50 bots walking continuously in one instance, the p95 broadcast flush time stays under 10 ms. See [12](12-testing-and-acceptance.md). It is measured in local dev through `/api/dev/stats`. Deployed Workers only advance the clock at I/O, so a flush timed there reads 0 ms; use the CPU time in Workers observability instead.
- No log line or stored record contains an IP address or user agent (checked by a test that greps captured logs).

## Open decisions

1. **Instance fill strategy.** Fill-first (default, so people see each other) or balanced? Revisit with real traffic.
2. **Rate-limit values** after the first load test and soft launch.
3. ~~**Restored position after a reload.**~~ Decided in M2 (default, change freely): both. A valid resume restores the place, mat and name from the resume record, and the first `pos` after any welcome may be anywhere walkable (§ Movement rule).
