# 03 — Rituals

## Purpose

Every action a visitor can take, end to end. Each block uses the same headings so a ritual can be built in one pass (see the `add-ritual` skill). Message names refer to [04 Realtime protocol](04-realtime-protocol.md). Limits and durations refer to [04 § Constants](04-realtime-protocol.md#constants).

General rules for all rituals:
- The server is the authority for anything shared: queues, spots, mats, lamps and counters. The client shows optimistic feedback only where a block says so.
- Every ritual that others can see is sent as a small event. Others' clients play the same animation and a quieter, spatialised version of the sound.
- Rituals are never rewarded with points, badges or streaks.

---

## Namaste (नमस्ते)

- **Purpose:** greet everyone present.
- **Where:** anywhere.
- **Input:** HUD button "Namaste", or key `3`.
- **UI:** the button shows a 1.5 s cooldown ring.
- **Network:** client sends `gesture {g:"namaste"}`. Others receive `event {kind:"namaste", from}`.
- **Server rule:** cooldown `GESTURE_COOLDOWN_MS`. The visitor must be connected.
- **Animation:** joined palms at the chest with a slight nod, 1.2 s. Remote avatars play the same.
- **Sound:** none.
- **Accessibility:** the button label is "Namaste — greet everyone". The screen reader announces "You greeted everyone".
- **Acceptance:** two clients in the same instance. A's namaste appears on B within 300 ms on a local network, and a repeat within the cooldown is ignored.

## Pranam (प्रणाम)

- **Purpose:** bow before the deity or the Ganesha shrine.
- **Where:** anywhere in the courtyard, mandapa or at the Ganesha shrine. The avatar turns to face the nearest shrine before bowing.
- **Input:** HUD "Bow", or key `1`.
- **Network:** `gesture {g:"pranam"}` → `event {kind:"pranam", from}`. The pose becomes `pranam` for the duration.
- **Server rule:** cooldown `GESTURE_COOLDOWN_MS`.
- **Animation:** standing bow with joined palms raised to the forehead, 2.5 s. Full prostration (dandavat) is **not** included in v1.
- **Sound:** none.
- **Facing:** the bow starts once the avatar has finished turning. Other clients start it when the bowing avatar, drawn behind server time, has caught up, and turn that avatar towards the same shrine (`bowTarget` in `world.ts`), whatever its stream says.
- **Acceptance:** the avatar faces the sanctum (or the Ganesha murti when within 6 m of it) before bowing.

## Ring a bell (घंटी)

- **Purpose:** announce one's arrival before the deity, as is customary.
- **Where:** within `BELL_REACH_M` of a bell: `gate`, `path-1`…`path-8`, `mandapa-n`, `mandapa-s`.
- **Input:** tap the bell, or the context button "Ring bell", or key `E` when near.
- **Network:** `bell {bell:"mandapa-n"}` → `event {kind:"bell", from, bell}`.
- **Server rule:**
  - The visitor must be within `BELL_REACH_M + 1` of that bell.
  - Per-visitor cooldown `BELL_COOLDOWN_MS`.
  - Per-bell rate cap `BELL_MAX_PER_SEC`. Rings beyond it are dropped silently so the hall never sounds chaotic.
- **Animation:** reach up and strike, 0.8 s. The bell swings.
- **Sound:** a brass bell sample (3 variants, random pitch ±3%), on the effects channel and spatialised. Clients cap simultaneous bell voices at 4.
- **Acceptance:** ringing from 5 m away is rejected by the server. Twenty visitors ringing at once produce at most `BELL_MAX_PER_SEC` audible rings per bell per second.

## Japa mala (जप माला)

- **Purpose:** personal mantra repetition, *ॐ नमः शिवाय* (Om Namah Shivaya).
- **Where:** anywhere. Seated on a mat is the natural place.
- **Input:** HUD "Japa" opens the mala view. Each bead advances with a swipe down, a tap on the bead, `Space` or `↓`. `Esc` or "Close" leaves.
- **UI:**
  - A close-up of a rudraksha mala: 108 beads plus the meru (sumeru) bead, with tassel.
  - The mantra is shown in Devanagari with romanisation beneath (spec 07), and fades after the first 3 beads unless the visitor pins it.
  - Counter "*n* / 108" and "Malas today: *m*" (local).
- **Meru rule:**
  - On reaching bead 108, the mala does **not** pass over the meru. The view shows the hand turning the mala around, and the next mala starts at bead 1 going the other way.
  - The meru is never counted.
  - An attempt to continue "through" the meru shows the hint "Turn the mala here" (यहाँ से माला पलटें).
- **Network:**
  - Opening the mala sets the pose to `japa` (sent with `pos`).
  - Each completed mala sends `japa.mala` (rate-limited) so the temple-wide "malas today" counter can grow.
  - Individual beads are **not** sent.
- **Server rule:** `japa.mala` is accepted at most once per `JAPA_MALA_MIN_MS` per visitor, and only while the visitor's pose is `japa`.
- **Animation:** the avatar holds a mala in the right hand, fingers moving. It's seated if on a mat, otherwise standing.
- **Sound:** optional soft bead click (effects channel). Optional personal mantra loop (chant channel, local only, never broadcast).
- **Local storage:** total malas and the current bead MAY be kept in `localStorage` (`sannidhi:japa-v1`).
- **Accessibility:** the screen reader announces the count every 9 beads and at each mala. Every bead is reachable by keyboard.
- **Acceptance:**
  - 108 advances complete one mala and turn the mala. The 109th advance is bead 1 of mala 2.
  - Advances faster than 80 ms apart are coalesced, so holding a key can't spin the count.
  - Closing and reopening within 30 min keeps the position.

## Pradakshina (परिक्रमा)

- **Purpose:** walk around the shrine with it on one's right.
- **Where:** the pradakshina path ([02](02-temple-world.md#pradakshina-path)).
- **Input:** walk it freely, or press "Parikrama" near checkpoint `E` to auto-walk the route at walking pace. Any movement input cancels the auto-walk.
- **UI:** small footprints on the path show the direction. After a completed round: "Parikrama *n* complete" (परिक्रमा *n* पूर्ण).
- **Network:** nothing extra. The server counts rounds from the position stream.
- **Server rule:**
  - **Mode `half-somasutra`:** a round is the checkpoint sequence `E → S → W → N → W → S → E`, all reached within `PRADAKSHINA_MAX_MS`.
  - **Mode `full`:** a round is `E → S → W → N → E`.
  - Reversing direction mid-round resets the sequence, except for the defined turn-back at `N` in half mode.
  - Each completed round sends the visitor `pradakshina.done {n}` and increments the temple-wide counter.
- **Animation:** normal walk. No special pose.
- **Acceptance:**
  - Walking anticlockwise from `E` never counts.
  - In half mode, crossing the channel is impossible (blocked) and the turn-back at `N` counts correctly.
  - Server tests drive scripted position streams for each case.

## Light a diya (दीया जलाएँ)

- **Purpose:** offer light. One lamp per visitor at a time, burning for `DIYA_BURN_MS`.
- **Where:** one of `DIYA_SPOTS` (4) standing spots around the deepa stand.
- **Flow:**
  1. The visitor presses "Light a diya" (context button within 4 m of the stand, or the HUD shortcut, which first walks them there). Client sends `diya.request {req}`.
  2. The server either:
     - grants a free spot (`diya.turn {req, spot}`); or
     - queues the visitor (`diya.queue {pos}`, updated as the queue moves); or
     - refuses with `diya.no {req, why}`, where `why` is `"has-lamp"`, `"stand-full"` or `"busy"`.
  3. On `diya.turn`, the avatar walks to the spot. On arrival the client plays the 5 s lighting animation and sends `diya.light {req}`.
  4. The server checks the visitor is at the spot and the turn hasn't expired (`DIYA_TURN_TIMEOUT_MS`). It then creates a lamp `{slot, litAt, expiresAt}` in the first free of `DIYA_SLOTS` (108) slots and broadcasts `diya.lit {lamp}`. When the lamp expires, it broadcasts `diya.out {slot}`.
  5. The visitor's spot frees and the next in the queue gets `diya.turn`.
- **UI:**
  - The queue position reads "*n* ahead of you" (आपसे पहले *n* लोग). "Leave queue" is always available.
  - The visitor's own lamp is subtly highlighted with "Your diya is burning" and a remaining-time ring.
- **Server rule:**
  - One active lamp per visitor.
  - Lamps persist in Durable Object storage, so they keep burning across hibernation and visitor disconnects.
  - When all 108 slots are lit, new requests get `"stand-full"` with the time until the next slot frees.
- **Animation:** kneel slightly, strike a match, touch it to the wick. The flame grows.
- **Sound:** match strike plus a soft whoosh (effects).
- **Acceptance:**
  - Five visitors requesting at once: four get spots and one is queued, and gets a turn when a spot frees.
  - A lamp lit by a visitor who then leaves keeps burning for the full duration and is visible to newcomers.
  - A second request while one's lamp burns gets `"has-lamp"`.

## Offer water — jal (जल अर्पित करें)

- **Purpose:** offer water to Shiva, symbolically. The linga is never touched by an avatar.
- **Where:** the threshold spot beside the sanctum door, reached along the side of the mandapa, never along the Nandi axis.
- **Flow:**
  - The same queue pattern as the diya, with a single spot: `jal.request {req}` → `jal.turn {req}` / `jal.queue {pos}` / `jal.no {req, why}`.
  - On arrival, the client plays the 8 s pouring animation and sends `jal.done {req}`.
  - The server broadcasts `event {kind:"jal", from}` and frees the spot.
- **Variant:** a "bilva" toggle in the context menu offers a bel patra leaf instead of water, with the same flow and `event {kind:"bilva"}`.
- **Server rule:**
  - One visitor at the spot at a time.
  - Per-visitor cooldown `JAL_COOLDOWN_MS`.
  - Turn timeout `JAL_TURN_TIMEOUT_MS`.
- **Animation:** stand at the threshold, pour a thin stream from a copper lota towards the linga. The water is shown flowing out along the jaladhari channel.
- **Sound:** soft water trickle (effects, spatial).
- **Acceptance:**
  - The avatar's path to the spot never enters the Nandi axis or the garbhagriha.
  - Two visitors: the second is queued until the first finishes or times out.

## Sit on a mat (बैठें)

- **Purpose:** sit for darshan, japa or aarti.
- **Where:** `MAT_COUNT` (40) mats in two blocks either side of the mandapa aisle.
- **Input:** "Sit" (context button in the mandapa, or HUD). The server picks the nearest free mat. Tapping a specific free mat requests that one.
- **Network:** `sit {req, mat?}` → `sit.ok {req, mat}` or `sit.no {req}`. `stand` frees the mat. Leaving or disconnecting frees it after the resume window.
  - The client asks from inside the mandapa: "Sit" asks for the nearest free mat, and a tapped mat is asked for when the visitor arrives at it.
  - `sit.ok` holds the mat for the visitor. The avatar walks to it and sends `pos` with pose `sit`. The server then places the avatar on the mat, facing the sanctum.
  - Others see the mat as taken from `sit.ok` on (the `mat` field of the visitor's state).
- **Server rule:** one visitor per mat. The visitor must be in the mandapa. Mats are released on disconnect after `RESUME_WINDOW_MS`.
- **Animation:** sit cross-legged (sukhasana), hands in the lap, facing the sanctum. The camera eases to the darshan view.
- **Acceptance:**
  - Two visitors requesting the same mat at once: exactly one gets it.
  - A seated avatar's yaw always faces the sanctum.

## Darshan view (दर्शन)

- **Purpose:** look upon the deity.
- **Input:** HUD "Darshan" (eye icon), or key `V` (see [07](07-ui-and-language.md#keyboard)).
- **Behaviour:** the camera frames the linga through the sanctum door. This is local only, with no network message. It is the default view while seated. Any look input returns to the orbit camera (when standing).

## Aarti (आरती)

- **Purpose:** shared worship twice daily.
- **When:** `AARTI_TIMES_IST` (06:00 and 19:00 IST). It lasts as long as the aarti recording (spec 06). The schedule is computed identically on client and server from `packages/protocol/src/schedule.ts`.
- **Before:**
  - From 15 minutes before, a gentle banner reads "Aarti begins at 7:00 pm" (आरती 7:00 बजे), in local time with IST in brackets.
  - From 2 minutes before, the mandapa bells ring and the HUD offers "Go to the mandapa", which auto-walks the visitor to the courtyard edge or a free mat.
- **During:**
  - Everyone hears the aarti from the same position (offset = server time − start, see spec 06).
  - The sanctum lamps brighten and a five-wick aarti lamp circles clockwise before the linga (see Open decisions for whether a pujari figure performs it).
  - Conch at the start, bells throughout.
  - Visitors may namaste, pranam and ring bells. Diya and jal queues stay open. Japa stays available.
- **After:**
  - **Take aarti:** for `AARTI_PLATE_MS` (10 min) after the end, the aarti plate rests at its stand. Within 2 m, "Take aarti" plays the hands-over-flame-to-eyes animation and sends `gesture {g:"aarti"}`. The server only accepts it in this window.
  - **Receive prasad:** during the same window, "Receive prasad" shows a small sweet in cupped hands (local animation plus `gesture {g:"prasad"}`). It's symbolic, and nothing is collected or counted per person.
- **Joining late:** a visitor who arrives mid-aarti hears it from the current position, not the beginning.
- **Acceptance:**
  - Two clients in different time zones with skewed device clocks (±2 min) hear the aarti within 250 ms of each other, after clock sync.
  - Arriving 90 s late starts playback at about 90 s.
  - "Take aarti" outside the window is rejected.

## Temple-wide "today" counters

- **What:** today's (IST) totals across all halls: diyas lit, malas completed, parikramas completed and distinct visits. They are shown on the board at the gate and in the "Who's here" sheet.
- **How:**
  - RoomDOs report increments to the DirectoryDO in batches (spec 05).
  - Clients get `counters {today}` on join and every `COUNTERS_PUSH_MS`.
  - The counters reset at 00:00 IST.
- **Rule:** counters are communal only. No per-person totals are shown or stored on the server.

## Accessibility for all rituals

- Every action has a HUD button with a text label, a keyboard key (spec 07) and a screen-reader announcement.
- No ritual depends on colour alone, fast reactions or precise timing.
- Sound is never required. Every audio cue has a visual counterpart.

## Acceptance criteria

The per-ritual acceptance lines above, plus:
- Every client→server message used here appears in the spec 04 message and rate-limit tables.
- No ritual exposes a per-person count to anyone but that person.

## Open decisions

1. **Aarti performer.** A respectful stylised pujari figure performing the aarti, or a lamp-only choreography (the lamp moves on its own path with brightening light)? The figure is more meaningful but needs careful modelling and advisor review.
2. **Dandavat (full prostration).** Add it later as a pranam variant in the mandapa?
3. **Rudraksha vs tulsi mala.** Rudraksha is the default for a Shiva temple. Should the mala view offer other malas?
4. **Personal mantra audio.** Use a single recorded "Om Namah Shivaya" loop, or none in v1?
