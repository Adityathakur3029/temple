# Sannidhi specs

These documents define what Sannidhi is and how it works. They are the source of truth for the code. When behaviour changes, the spec changes in the same commit.

## Reading order

| # | Spec | Covers |
|---|---|---|
| 00 | [Vision](00-vision.md) | Product, audience, principles, non-goals, glossary |
| 01 | [Architecture](01-architecture.md) | System diagram, monorepo layout, environments |
| 02 | [Temple world](02-temple-world.md) | 3D layout, sacred zones, light, camera, avatar |
| 03 | [Rituals](03-rituals.md) | Every visitor action, end to end |
| 04 | [Realtime protocol](04-realtime-protocol.md) | Halls, instances, messages, limits, constants |
| 05 | [Server](05-server.md) | Worker and Durable Objects design, abuse protection |
| 06 | [Sound and aarti](06-sound-and-aarti.md) | Audio channels, synced aarti, licensing |
| 07 | [UI and language](07-ui-and-language.md) | Screens, controls, Hindi/English strings, accessibility |
| 08 | [Cultural guidelines](08-cultural-guidelines.md) | Respectful depiction and behaviour rules |
| 09 | [Privacy, analytics, donations](09-privacy-analytics-donations.md) | What we collect, events, UPI donations, legal checklist |
| 10 | [Performance](10-performance.md) | Device targets, download/render/data budgets |
| 11 | [Assets and licensing](11-assets-and-licensing.md) | Asset list, budgets, pipeline, manifest, credits |
| 12 | [Testing and acceptance](12-testing-and-acceptance.md) | Test layers, load tests, CI gates |
| 13 | [Roadmap](13-roadmap.md) | Milestones M0–M6 with exit criteria |
| — | [Prior art: Sansa](reference/prior-art-sansa.md) | What we learned from sansatemple.com, and what we must not copy |

## Conventions

- **MUST** is a requirement, **SHOULD** is a strong default, **MAY** is optional.
- Every spec ends with **Acceptance criteria** (testable statements) and **Open decisions**.
- Numbers that code depends on are defined once, in [04 Realtime protocol § Constants](04-realtime-protocol.md#constants), and mirrored in `packages/protocol/src/constants.ts`.
- World coordinates are in metres. `+x` is north, `+z` is east, and `+y` is up. The temple faces east and the sanctum is at the origin.
- Times are India Standard Time (IST, UTC+05:30) unless a spec says otherwise.

## Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-11-03 | Fictional Himalayan Shiva temple (Nagara stone shrine, deodar forest, linga, Nandi, Ganesha shrine at entry, bells) | Decided by owner |
| 2026-11-03 | Hindi + English at launch | Decided by owner |
| 2026-11-03 | Optional UPI donations only, never gating anything | Decided by owner |
| 2026-11-03 | Working title "Sannidhi" | Default, change freely |
| 2026-11-03 | Stack: Vite + TS + Three.js; Cloudflare Worker + Durable Objects; Pages; R2 | Default |
| 2026-11-04 | Assets are served from R2 through a small asset Worker, not an R2 custom domain (spec 01) | Decided by owner |
| 2026-11-04 | Node 22+ (Node 20 is end of life; wrangler 4 needs 22) | Decided by owner |
| 2026-11-04 | The web app is a Worker with static assets, not Cloudflare Pages (Cloudflare is folding Pages into Workers; spec 01) | Decided by owner |
| 2026-11-03 | 20 halls × up to 8 instances × 50 visitors | Default |
| 2026-11-03 | Aarti at 06:00 and 19:00 IST | Default, check with advisor |
| 2026-11-03 | Half pradakshina at the somasutra (jaladhari) by default | Default, check with advisor |
| 2026-11-04 | Start M2 before M1's last two exit checks (the Low-phone walk at ≥ 30 fps, and the advisor's sign-off in spec 08). Both stay open and are still required | Decided by owner |
| 2026-11-04 | A reload keeps the visitor's place: through the resume record within 60 s, and after that by accepting the first walkable position (spec 05, open decision 3) | Default |
| 2026-11-04 | `PROTOCOL_VERSION` stays 1 while adding close code `4004`, changing `StateTuple.mat` to mean "the mat held", and adding constants. No client speaking v1 has shipped; v1 is frozen from the first public release | Default |
| 2026-11-04 | No binary deltas: Workers negotiates permessage-deflate, and 50 bots measure 2.0 KB/s per visitor on the wire (budget 3) (spec 04, open decision 1) | Measured |
| 2026-11-04 | No donations for now. The support sheet isn't built and `VITE_UPI_VPA` stays unset, so no support UI appears (spec 09) | Decided by owner |
| 2026-11-04 | The owner supplies the recordings (ambience, aartis, bells) and a 24-hour schedule of what plays when. Each file still needs a traceable licence (specs 06, 11) | Decided by owner |
| 2026-11-05 | Build the swappable asset slots now, during M2, so models downloaded from the internet can stand in until artists' models replace them in M5 (specs 11, 13) | Decided by owner |
| 2026-11-05 | Downloaded models made by people MAY stand in for the linga, Nandi and Ganesha too, if licensed, following spec 08 § Depiction, copying no real temple's murti, and marked `interim`; never AI-made; listed for the advisor, who reviews them before launch (spec 08 § Depiction) | Decided by owner |
| 2026-11-05 | KTX2 textures are encoded with `ktx2-encoder` (WebAssembly) instead of the KTX-Software `toktx` tool, so the asset build needs nothing installed on Windows (spec 11) | Default |
| 2026-11-05 | Until the lighting pass (M5), models use matte lighting like the greybox and keep only colour textures (spec 11 § Formats) | Default |

## Open decisions (collected)

These are repeated in the spec they belong to.

1. Final product name and domain (trademark check). See [00](00-vision.md#open-decisions).
2. Religious advisor or priest who signs off on spec 08 and the aarti. See [08](08-cultural-guidelines.md#open-decisions).
3. Aarti recording: supplied by the owner (2026-11-04); the licence for each file is still to be recorded. See [06](06-sound-and-aarti.md#open-decisions).
4. Who receives donations: an individual, a trust, or a Section 8 company. On hold: no donations for now (2026-11-04). See [09](09-privacy-analytics-donations.md#open-decisions).
5. Whether to show a pujari figure during aarti or use a lamp-only choreography. See [03](03-rituals.md#open-decisions).
6. Seasonal weather (snow, monsoon mist) in M5 or later. See [02](02-temple-world.md#open-decisions).
