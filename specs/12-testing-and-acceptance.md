# 12 — Testing and acceptance

## Purpose

How we know Sannidhi works: the test layers, what each covers, the CI gates, and the load and soak tests that prove the budgets.

## Test layers

| Layer | Tool | Lives in | Covers |
|---|---|---|---|
| Protocol unit | Vitest | `packages/protocol` | Type guards (valid and invalid payloads, fuzzed JSON), constants match spec 04, `schedule.ts` IST maths (aarti times, day phases, midnight rollover from every UTC offset), `world.ts` zone tests |
| Client logic unit | Vitest (jsdom where needed) | `apps/web` | Mala counting and the meru turn, queue UI state machines, interpolation, clock-sync offset choice, tab ownership, idle and calm mode, i18n key parity, Lite detection |
| Durable Object | `@cloudflare/vitest-pool-workers` | `apps/realtime` | Everything in [05 § Acceptance](05-server.md#acceptance-criteria): join/leave, capacity, resume, each ritual's rules, movement correction into each sacred zone, strikes, hibernation rebuild, lamps across restart, DirectoryDO pick and counters rollover |
| End to end | Playwright | `apps/web/e2e` | Real browser against `wrangler dev` (below) |
| Visual | Playwright screenshots | `apps/web/e2e/visual` | HUD and sheets at 360×640 and 1440×900, both languages, light and dark system theme |
| Accessibility | axe-core in Playwright + manual | `apps/web/e2e/a11y` | No WCAG 2.2 AA violations in DOM UI; manual TalkBack and VoiceOver pass at M5 |
| Load | `tools/bots` | `tools/bots` | Server and data budgets |
| Soak | `tools/bots` on staging | — | 24 h stability across aarti times and the IST midnight rollover |
| Device | Manual | — | The spec 10 device matrix at each milestone |
| Cultural | `cultural-reviewer` agent + advisor | spec 08 sign-off log | All visible and audible content |

## End-to-end scenarios (minimum set)

1. **First visit:** the boot screen shows, the temple becomes interactive, the onboarding hints appear in order, and the language toggle switches every visible string.
2. **Two visitors:** context A and context B join the same hall. A walks and B sees it within 300 ms (local). A does namaste and B sees the animation event.
3. **Sacred zones:** scripted taps and keyboard input try to walk into the garbhagriha and across the Nandi axis. The avatar never ends up there.
4. **Diya queue:** five contexts request a diya at once. Four get spots, one queues, the lamps appear for everyone, and a new context sees the existing lamps.
5. **Jal:** two contexts. The second is queued, and the path to the threshold avoids the Nandi axis.
6. **Mala:** 108 advances turn the mala, the 109th starts mala 2, and rapid key repeat is coalesced.
7. **Parikrama:**
   - Auto-walk completes one round in half mode.
   - Walking anticlockwise doesn't count.
   - In full mode (config switch), the full loop counts.
8. **Aarti:** with the clock mocked to 18:59:30 IST, the banner appears, aarti starts at 19:00, and a context joining at 19:01:30 starts playback near 90 s. "Take aarti" works only within the window.
9. **Reconnect:**
   - Drop the network for 20 s. The visitor keeps the same name and mat.
   - Drop it for 90 s. The visitor rejoins as new.
   - A server close with `4002` shows the refresh message.
10. **Tabs:** opening a second tab moves rendering there and shows the rest overlay in the first. A hidden tab runs no frames.
11. **Donations:** with `VITE_UPI_VPA` unset, no support UI anywhere. With it set, the sheet is reachable only from Settings and Exit, and the link and QR match.
12. **Privacy:** the network log shows no third-party requests except the Cloudflare Web Analytics beacon on production builds.

Each scenario runs in Chromium on desktop and in mobile emulation (Pixel-class viewport, touch, 4× CPU throttle). WebKit and Firefox run nightly.

Test hooks, all in dev builds only:
- `?hall=hall-NN` joins that hall, so multi-visitor tests don't share visitors or held mats.
- `window.__sannidhi.setTimeScale(n)` fast-forwards walking. Above 1 the page goes offline, because the server's speed check would correct every step. Back at 1 it resumes where it is.
- Network drops (scenario 9) go through Playwright's `routeWebSocket`, which can cut and restore the socket.

## Load and soak tests (`tools/bots`)

A Node script using the `ws` package. Bots speak the real protocol from `packages/protocol`.

- **Behaviours** (mixable by percentage): `wanderer`, `sitter`, `japa`, `diya-seeker`, `jal-seeker`, `bell-ringer`, `parikrama`, `reconnector`.
- **Options:** `--url`, `--hall`, `--n`, `--mix`, `--duration`, `--lite`, plus:
  - `--origin`: an allowed app origin, sent as the `Origin` header;
  - `--ramp`: the seconds over which the bots join;
  - `--check instance`: exit with an error unless the instance load test below passes.
- **Built so far:** `wanderer`, `bell-ringer` and `reconnector` (M2). The others arrive with their rituals in M3.
- Against local dev, the report adds the server's flush times from `/api/dev/stats` (spec 05).
- **Report:**
  - connect time p50/p95;
  - delta interval p50/p95;
  - downstream bytes per bot per second;
  - `correct` count;
  - close codes;
  - errors.

| Test | Setup | Pass when |
|---|---|---|
| Instance load | 50 bots in one instance, 10 min, mixed behaviours | p95 broadcast flush < 10 ms (server metric); average downstream per bot ≤ 3 KB/s; zero unexpected closes |
| Hall fill | 400 bots joining one hall over 2 min | Instances open in order, no instance exceeds 50, `4001` retries succeed |
| System | 2,000 bots across all halls, 30 min | Zero 5xx; `/api/rooms` p95 < 100 ms; no DO exceptions |
| Soak | 200 bots on staging for 24 h, spanning 06:00, 19:00 and 00:00 IST | No memory growth in DO metrics; counters roll over at midnight; lamps expire correctly |
| Chaos | Deploy the realtime Worker mid-test | Clients reconnect with resume tokens; ≥ 95% keep their visitor id |

## CI gates

| When | Runs |
|---|---|
| Every push / PR | `npm run check` (`tsc --noEmit`, ESLint, i18n key parity, size budgets, `sacred`-asset path check, spec link check) · unit tests · DO tests · e2e on Chromium (desktop + mobile emulation) |
| Nightly | e2e on WebKit and Firefox · visual and a11y suites · instance load test against staging |
| Before release | Full e2e matrix · system load test · the `release` skill's pre-flight |

The **spec link check** (`tools/check/links`) fails if any relative Markdown link in `CLAUDE.md` or `specs/` points to a missing file or heading.

## Definition of done (any change)

- The relevant spec is updated in the same change.
- Tests are added or updated at the right layer and pass locally and in CI.
- `npm run check` passes.
- The relevant reviewer agents (`protocol-reviewer`, `cultural-reviewer`, `perf-auditor`) report no blockers.

## Acceptance criteria

- Every acceptance criterion in specs 02–11 maps to at least one automated test or to a named manual check in the milestone checklist (spec 13).
- CI blocks merging when any gate fails.

## Open decisions

1. **CI provider:** GitHub Actions is the default, assuming the repo lives on GitHub.
2. **Real-device cloud** (for example BrowserStack) for nightly Android runs, or manual devices only.
