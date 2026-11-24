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
- **Sound:** a brass bell sample (up to 3 variants, 2 for now; random pitch ±3%), on the effects channel. Your own ring plays plainly; another visitor's comes from that bell, 6 dB quieter. Clients cap simultaneous bell voices at 4.
- **Acceptance:** ringing from 5 m away is rejected by the server. Twenty visitors ringing at once produce at most `BELL_MAX_PER_SEC` audible rings per bell per second.

## Wash hands (हाथ धोएँ)

- **Purpose:** wash the hands before entering, as visitors customarily do at a temple's water point. It is a preparation, not an offering.
- **Where:** the washing trough outside the gate, on the left of the approach as a visitor arrives (spec 02). It has five brass taps, `tap-1` … `tap-5`. The visitor stands at a tap within `TAP_REACH_M`.
- **Input:** tap a tap, or the context button "Wash hands", or key `E` near the trough. The context button appears within 2.2 m of the trough, outside the gate (`WASH_OFFER_M`, client); "Wash hands" walks the visitor to the nearest tap that nobody is standing at (or the nearest tap, if all are in use) and then washes.
- **Entry is not required.** Anyone may walk through the gate without washing. The client remembers, for this visit only, whether the visitor has washed; if they reach the gate on a first visit without having washed, the gate hint adds "You may wash your hands at the taps before entering" (spec 07 § Onboarding). Nothing is blocked, recorded or shown to others.
- **Network:** `wash {tap:"tap-3"}` → `event {kind:"wash", from, tap}`.
- **Server rule:**
  - The visitor must be within `TAP_REACH_M + 1` of that tap.
  - Per-visitor cooldown `WASH_COOLDOWN_MS`.
  - Taps are not reserved. Two visitors at one tap is allowed but the client avoids it.
- **Animation:** the avatar faces the tap, leans slightly, holds cupped hands under the spout and rubs them together, then shakes the water off gently, 4 s. A thin stream runs from the spout for the duration. Remote avatars play the same from the event. Nothing playful: no splashing.
- **Sound:** running water from a tap, 4 s (effects channel, spatial). Clients cap simultaneous tap voices at 3.
- **Accessibility:** the context button reads "Wash hands" (`action.wash`). The screen reader announces "You washed your hands" (`a11y.wash`). The running stream is the visual counterpart of the sound.
- **Acceptance:**
  - Washing from 4 m away is rejected by the server.
  - A second wash within the cooldown is ignored.
  - Two clients: A's washing appears on B at the same tap.
  - A visitor who never washes can still walk through the gate.

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

## Offer water, bel patra or a flower — jal (जल अर्पित करें)

- **Purpose:** offer water, a bel patra (bilva leaf) or a flower to Shiva, symbolically. The linga is never touched by an avatar.
- **Where:** two jal spots at the threshold, one each side of the sanctum door: `JAL_SPOTS` north (1.9, 3.4) and south (−1.9, 3.4), reached along the sides of the mandapa, never along the Nandi axis. Each side has its own turn and queue, so two visitors may offer at once, one at each side. Beyond each spot, against the sanctum's front wall, stands a low stone offering bench (`OFFERING_BENCHES`, (±3.55, 2.86), 0.9 × 0.4 m, 0.3 m high) holding a copper lota of water, a basket of bel patra and a basket of flowers (owner, 2026-11-24).
- **Input:**
  - Within `JAL_NEAR_M` (3 m) of either jal spot, the context area shows three buttons: "Offer water", "Offer bel patra" and "Offer a flower". Key `E` offers water.
  - Each one asks for the nearer side's spot: `jal.request {req, kind, side}`, where `kind` is `"water"`, `"bilva"` or `"flower"` and `side` is `"n"` or `"s"`.
- **Flow:**
  1. The server either gives the spot at once (`jal.turn {req, until}`), queues the visitor (`jal.queue {pos}`, sent again as the queue moves), or refuses (`jal.no {req, why}`, where `why` is `"cooldown"`, `"busy"` (already queued or offering, on either side) or `"not-near"` (too far from that side's spot)).
  2. On `jal.turn`, the avatar walks to its side's offering bench (`PICK_SPOTS`, 0.6 m in front of it), faces it and pauses 1.2 s to take up the lota, a leaf or a flower, then walks to that side's jal spot, faces the linga and plays the offering. It then sends `jal.done {req}`.
  3. The server checks the visitor holds the turn, is within `JAL_SPOT_REACH_M` (1 m) of that side's spot and the turn hasn't expired. It broadcasts `event {kind, from}` to everyone else, where `kind` is `"jal"`, `"bilva"` or `"flower"`, and starts the visitor's `JAL_COOLDOWN_MS`.
  4. The spot frees and the next visitor in that side's queue gets `jal.turn`.
  - The client keeps the turn's `until`. If it passes before the offering begins, the client gives the turn up quietly; a late `jal.done` is ignored by the server, and then no cooldown or charanamrit follows.
  - A request with no reply within 4 s is given up, and requests go at most one a second.
  - A tab that resumes with a turn or queue place it no longer wants (after a reload) gives it up with `jal.cancel`.
  - A seated visitor isn't offered the buttons.
- **UI:**
  - While queued, the notice reads "*n* ahead of you" with "Leave queue". "Your turn" shows briefly when the turn comes.
  - Walking away, "Leave queue" or `Esc` sends `jal.cancel`.
  - A refusal for `"cooldown"` shows "You can offer again in a few minutes." Nothing is shown for `"busy"` or `"not-near"`.
- **Server rule:**
  - One visitor at each spot at a time. Each side's queue is first come, first served (spec 05).
  - A visitor may be in one queue only, once.
  - Per-visitor cooldown `JAL_COOLDOWN_MS` after an offering.
  - A turn not finished within `JAL_TURN_TIMEOUT_MS` passes to the next visitor.
  - The pose `offer` is accepted only from a visitor holding a turn.
  - Both sides' queues and turns are kept in Durable Object storage (`queues`), so they survive hibernation. A disconnected visitor keeps their queue place for the resume window (spec 05).
- **Animation:**
  - **Water** (8 s): the visitor holds a small copper lota in both hands and pours a thin stream towards the linga. For a few seconds after, a little water is seen flowing from the jaladhari spout on the north wall along its channel.
  - **Bel patra or flower** (4 s): the visitor steps to their side's `LAY_SPOTS` (±1.82, 3.25), close to the plate, bows slightly and lays the leaf or flower with both hands on that side's brass offering plate on the mandapa floor, `OFFERING_PLATES` (±1.6, 2.85), against the front wall beside the door, off the Nandi axis and the darshan carpets.
  - Each plate shows the most recent leaves and flowers offered on it in this instance (at most 12 per plate); a remote offering is laid on the plate nearer the visitor who made it. Each one fades after 10 minutes. This is drawn by each client from the events it receives, so a newcomer sees the plate empty.
  - The flower is a small white flower (see spec 08, check with advisor).
  - Remote avatars play the same animation at the spot.
- **Sound:** a soft water pour for water (effects, spatial for others). It plays once the `pour` sound file exists. Until then the offering is silent. Leaves and flowers make no sound.
- **Accessibility:** the screen reader announces "You offered water.", "You offered a bel patra." or "You offered a flower." when the offering ends.
- **Acceptance:**
  - The avatar's path to the spot never enters the Nandi axis or the garbhagriha.
  - Two visitors at the same side: the second is queued until the first finishes or times out, then gets the turn.
  - Two visitors at opposite sides both get a turn at once.
  - A second offering within the cooldown is refused with `"cooldown"`.
  - `jal.done` from someone not holding the turn, or more than 1 m from the spot, is ignored.

## Receive charanamrit (चरणामृत)

- **Purpose:** receive a few drops of water from the tirtha pot after making an offering, as devotees do at the end of worship. It is symbolic: nothing is counted per visitor or shown (only anonymous totals, spec 09).
- **Where:** within `JAL_NEAR_M` of either jal spot, from the small copper tirtha pot with its spoon that rests on a small stone stand beside that spot: `TIRTHA_POTS`, (2.75, 3.4) on the north side and (-2.75, 3.4) on the south, so nobody crosses the Nandi axis for it (owner, 2026-11-24).
- **When:** for `CHARANAMRIT_WINDOW_MS` (2 minutes) after the visitor's own offering (water, bel patra or flower), once per offering.
- **Input:** the context button "Receive charanamrit", or key `E`. The visitor steps onto the nearer of `CHARANAMRIT_SPOTS`, (2.3, 3.75) or (-2.3, 3.75), facing that side's pot first, if not already there.
- **Network:** `gesture {g:"charanamrit"}` → `event {kind:"charanamrit", from}`.
- **Server rule:**
  - The visitor must have completed an offering within `CHARANAMRIT_WINDOW_MS`, and not yet have received charanamrit for it.
  - The visitor must be within `JAL_NEAR_M + 1` of either jal spot.
  - Cooldown `GESTURE_COOLDOWN_MS`, shared with the other gestures.
- **Animation** (3.5 s):
  - The visitor turns to the tirtha pot.
  - The right hand, cupped, rests over the left palm and receives a few drops.
  - The hands are raised to the lips briefly, then the right hand passes lightly over the head.
  - Remote avatars play the same.
- **Sound:** none.
- **Accessibility:** the screen reader announces "You received charanamrit." when it ends.
- **Acceptance:**
  - Without an offering, or more than 2 minutes after one, the server ignores the gesture.
  - A second charanamrit for the same offering is ignored.

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

## Sit on a bench (बेंच पर बैठें)

- **Purpose:** rest on the lawn and look at the temple, away from the hall.
- **Where:** the seven lawn benches (`BENCHES`, spec 02): four by the gate path and three by the kund. Each bench seats two, so there are `BENCH_SEAT_COUNT` (14) bench seats. They share the seat numbers with the mats: mats are 0 … 39 and bench seats are 40 … 53 (`SEAT_COUNT` 54 in all), two per bench in `BENCHES` order, the −x seat first. A bench seat is 0.4 m either side of the bench's centre.
- **Input:** the same "Sit" button as for a mat. Within `BENCH_SIT_NEAR_M` (4 m) of a bench seat, outside the mandapa, it asks for the nearest free bench seat. Tapping a bench asks for its nearest free seat. Seated, the screen reader hears `a11y.seated.bench`; with no free seat, `bench.taken` (spec 07).
- **Network:** unchanged in shape: `sit {req, mat?}` → `sit.ok {req, mat}` or `sit.no {req}`, with `mat` 40 … 53 for a bench seat. `stand` frees it. The wider `mat` range is a breaking change, so `PROTOCOL_VERSION` goes up.
  - Each seat has a **seat spot** on the lawn just in front of the bench (0.52 m in front of its centre line, clear of the bench), where the visitor walks to and is placed. The avatar is drawn sitting on the slab behind that spot; the spot is only where the visitor "is" for walking and the server.
- **Server rule:** one visitor per seat. For a bench seat the visitor must be within `BENCH_SIT_NEAR_M` of that seat's spot (the mandapa rule still applies to mats). When `mat` is omitted, the server picks the nearest free mat inside the mandapa, or else the nearest free bench seat within reach, or answers `sit.no`. Seats are released like mats.
- **Animation:** sitting upright on the bench, knees bent, both feet flat on the ground (soles down, never towards the sanctum), hands in the lap, facing the temple (yaw π). Japa may be counted while seated on a bench, as on a mat. The camera stays in the orbit view: the darshan view is not forced from the lawn.
- **Sound:** none.
- **Analytics:** counted as `sit`, like a mat.
- **Accessibility:** the "Sit" button is keyboard and touch reachable as for mats.
- **Acceptance:**
  - Two visitors asking for the same bench seat at once: exactly one gets it.
  - A visitor in the mandapa still gets a mat, never a bench seat; a visitor by a bench never gets a mat.
  - A visitor seated on a bench faces the temple, and can stand and walk away without being stuck on the bench.

## Darshan view (दर्शन)

- **Purpose:** look upon the deity.
- **Input:** HUD "Darshan" (eye icon), or key `V` (see [07](07-ui-and-language.md#keyboard)).
- **Behaviour:** the camera frames the linga through the sanctum door. This is local only, with no network message. It is the default view while seated. Any look input returns to the orbit camera (when standing).

## Darshan between Nandi's horns — shringa darshan (शृंग दर्शन)

- **Purpose:** look upon the linga between Nandi's horns, as devotees do from behind Nandi.
- **Where:** within `SHRINGA_REACH_M` (1.2 m) of the shringa spot, `SHRINGA_SPOT` (0, 23.6), on the yard just behind Nandi's platform. It is off the Nandi axis (which ends at z 22), so the visitor stands there normally.
- **Input:** the context button "Darshan between Nandi's horns", or key `E` when near.
- **UI:**
  - The avatar turns to face the sanctum (yaw π). Your own avatar is hidden while the view is open, because the camera is just above and ahead of it.
  - The visitor steps onto the spot first if not already on it. The camera moves just behind Nandi's head, on the axis, a little above his horn tips, and looks at the linga between his horns, so they frame the sanctum door. The visitor can look around a little (±10° yaw and pitch).
  - Moving, `Esc`, `E` again or the "Back" button returns to the orbit camera.
  - With `prefers-reduced-motion`, the move is a cut.
- **Viewpoint:** the eye point and field of view live in the client camera (`SHRINGA_VIEW` in `camera.ts`; the target is the linga) and are tuned to the Nandi model in use, because the horns sit differently on each model. With the greybox Nandi, the view frames the linga over his back.
- **Network:** none. It is local only, like the darshan view. Others see the avatar standing behind Nandi, facing the sanctum.
- **Server rule:** none beyond normal movement. Only the camera is ever on the axis, never an avatar (spec 08).
- **Animation:** none in v1. Resting the fingers on the horns is left out (see Open decisions).
- **Sound:** none.
- **Accessibility:** the button label is "Darshan between Nandi's horns". The screen reader announces "Darshan between Nandi's horns: the linga, through the sanctum door." (`a11y.shringa`).
- **Acceptance:**
  - The button shows within 1.2 m of the spot and not elsewhere.
  - In the view, the camera is behind Nandi's head on the axis, never inside Nandi or the garbhagriha, and the linga is visible through the sanctum door.
  - Any move input closes the view, and no network message is sent while it is open.

## Whisper to Nandi (नंदी के कान में)

- **Purpose:** quietly tell Nandi one's prayer, as many devotees do, believing he carries it to Shiva. This is a description of the custom only: no visible text may promise that a prayer is carried or answered (spec 08).
- **Where:** within `NANDI_EAR_REACH_M` (1.0 m) of an ear spot, `NANDI_EAR_SPOTS`: (1.3, 21.5) and (−1.3, 21.5), beside Nandi's head (`NANDI_HEAD`, 0, 21.3) on either side of his platform. These are where the pradakshina carpet arms end, off the Nandi axis. Both ears are offered by default (see spec 08, check with advisor).
- **Input:** the context button "Whisper to Nandi", or key `E` when near. The visitor steps onto the nearer ear spot first if not already on it.
- **UI:** pressing again while the whisper plays does nothing. Nothing is typed, recorded or shown. The prayer stays in the visitor's own mind.
- **Network:** `gesture {g:"whisper"}` → `event {kind:"whisper", from}`.
- **Server rule:**
  - The visitor must be within `NANDI_EAR_REACH_M + 1` of an ear spot.
  - Cooldown `GESTURE_COOLDOWN_MS`, shared with the other gestures.
- **Animation:**
  - The avatar turns to face Nandi's head.
  - It leans a little towards the ear, with one hand cupped beside the mouth and the other at the chest, and holds for 3 s.
  - It finishes with joined palms and a small nod. The total time is 4 s.
  - The avatar never touches Nandi, and Nandi never moves. Remote avatars play the same.
- **Sound:** none. No voice, whisper sound or microphone is used.
- **Accessibility:** the button label is "Whisper to Nandi". When the whisper ends, the screen reader announces "You whispered your prayer to Nandi." (`a11y.whisper`).
- **Acceptance:**
  - Whispering from 3 m away from both ear spots is rejected by the server.
  - Two clients in the same instance: A's whisper appears on B within 300 ms on a local network, and a repeat within the cooldown is ignored.
  - The avatar faces Nandi's head before it leans.

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
5. **Which ear of Nandi.** Customs differ by region (some say the left ear, some the right). Both ears are offered by default. `NANDI_EAR_SPOTS` can be cut to one side if the advisor prefers.
6. **Fingers on the horns.** In many temples devotees rest the thumb and forefinger on Nandi's horns for shringa darshan. Should the view show the visitor's hands there, or keep the plain view?
