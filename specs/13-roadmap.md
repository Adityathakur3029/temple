# 13 — Roadmap

## Purpose

The order of work. Each milestone has deliverables and exit criteria, and the next milestone starts only when the exit criteria are met. Claude Code sessions should work inside one milestone at a time and say which one.

## M0 — Scaffold

**Deliverables**
- Git repo and npm workspaces (`apps/web`, `apps/realtime`, `packages/protocol`, `tools`), Node 22+, strict TypeScript, ESLint, Prettier.
- `packages/protocol` with every constant and type from spec 04 (handlers can be stubs), plus the constants test.
- Vite app showing the boot screen, the unsupported-device screen, and a spinning placeholder cube after the lazy load.
- Realtime Worker with `GET /api/rooms` (static data) and `/ws` echo. `wrangler.jsonc` with `staging` and `production` environments and the Durable Object migration (`new_sqlite_classes`).
- `tools/check` with the size-budget, i18n-parity and spec-link checks wired into `npm run check`.
- CI running `npm run check`, unit tests and one Playwright smoke test.

**Exit criteria**
- `npm run dev` works on Windows and on Linux CI.
- Staging deploy succeeds via the `release` skill.
- CI is green.

## M1 — Solo temple (greybox)

**Deliverables**
- The greybox world from spec 02's layout table: blockout shapes, walkable navmesh, the sacred and blocked zones in `world.ts`.
- Placeholder avatar with walk, idle and sit animations. Tap-to-walk, WASD, and the orbit and darshan cameras.
- Day/night phases on IST.
- Device tiers, Lite detection, tab ownership, idle and calm modes, view restore.
- English and Hindi locale files with the spec 07 starter strings, and the language toggle.

**Exit criteria**
- Walk gate → mandapa → around the pradakshina path on the Low device at ≥ 30 fps.
- No way to enter the sacred zones.
- First cultural sign-off (layout and zones) is recorded in spec 08.

## M2 — Presence

**Deliverables**
- RoomDO and DirectoryDO per spec 05: instance choice, welcome/delta/correct, names, resume, heartbeat auto-response, idle sweep, strikes, rate limits.
- Client networking: reconnect back-off, clock sync, interpolation, all close codes.
- Namaste, pranam and bells end to end.
- Hall list and "Who's here" sheets.
- `tools/bots` with `wanderer`, `bell-ringer` and `reconnector`.

**Exit criteria**
- The instance load test passes (spec 12).
- The two-visitor and reconnect e2e scenarios pass.
- The protocol-reviewer reports no blockers.

## M3 — Rituals

**Deliverables**
- Japa mala view with the meru rule. Pradakshina counting in both modes.
- Mats and seating, the darshan view.
- Diya queue and lamps, jal and bilva queue.
- Today counters and the gate board.
- Bots for every ritual behaviour.

**Exit criteria**
- Every acceptance line in spec 03 has a passing test.
- Ritual flows get cultural sign-off (spec 08).

## M4 — Sound and aarti

**Deliverables**
- Mixer and channels, ambience stems, effects, spatial bells with voice caps.
- Synced aarti with drift correction, cue-driven lamp choreography, take aarti and prasad, Media Session.
- Licence entries for every audio file.

**Exit criteria**
- The aarti sync test passes on two real devices with skewed clocks (spec 06).
- The memory check on the Low device passes.

## M5 — Art, language, accessibility

**Deliverables**
- Final art for every asset in spec 11. LODs and vertex animation textures for avatars. KTX2 Full and Lite tiers.
- The sacred assets, made by people and reviewed by the advisor.
- Native-speaker review of all Hindi strings. Fonts subset.
- Accessibility pass: keyboard, TalkBack and VoiceOver, reduced motion, "Describe the scene".
- Credits screen, privacy page, support sheet (behind `VITE_UPI_VPA`).
- Optional: seasonal weather, aarti lyrics.

**Exit criteria**
- All spec 10 budgets pass on the device matrix.
- Advisor sign-off for M5 is recorded.
- The Hindi review is complete.
- The a11y suite is clean.

## M6 — Launch

**Deliverables**
- Domain and final name. Cloudflare rate-limiting rules. Alerts (spec 05). Production analytics.
- System load test and 24 h soak on staging.
- Donation legal checklist completed (spec 09) before setting `VITE_UPI_VPA` in production.
- Soft launch: first 5 halls only, then all 20.

**Exit criteria**
- 7 days of soft launch with no severity-1 incident (outage, sacred-zone bug, privacy issue).
- Owner go/no-go for the full launch.

## After launch (backlog, not scheduled)

- Festival events (Maha Shivaratri all-night vigil, Shravan Mondays) using hand-entered dates (spec 08).
- A third language.
- Binary deltas, if data measurements call for them (spec 04).
- An audio-only "listen to aarti" page that installs as a PWA.
- More shrines, or a second temple with a different tradition (each needs its own spec set and advisor).
- VR / WebXR viewing.
