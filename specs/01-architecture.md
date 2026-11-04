# 01 — Architecture

## Purpose

How the pieces fit together, where they run, and how the repository is laid out.

## System overview

```
                 ┌──────────────────────────── Cloudflare ────────────────────────────┐
 Visitor's       │                                                                     │
 browser  ──────►│  Static assets Worker: sannidhi-web (HTML, JS, CSS, fonts, images)  │
 (Three.js,      │                                                                     │
  Web Audio)     │  R2 + asset Worker: /v/<release>/… models, KTX2 textures, audio     │
   │  ▲          │    cache-control: public, max-age=31536000, immutable                │
   │  │          │                                                                     │
   │  └─────────►│  Realtime Worker                                                    │
   │   WebSocket │    GET  /api/rooms      → DirectoryDO (hall counts, today counters)  │
   └────────────►│    GET  /ws?hall=…&v=1  → picks instance → RoomDO "hall-03#2"       │
                 │    POST /api/beacon     → Workers Analytics Engine (counts only)     │
                 │                                                                     │
                 │  Web Analytics (cookie-free page views)                             │
                 └─────────────────────────────────────────────────────────────────────┘
```

- **Static app (a Worker with static assets, `sannidhi-web`).** HTML, the JS bundle, CSS, fonts and small images. It runs no code: Cloudflare serves `apps/web/dist` directly, configured by `apps/web/wrangler.jsonc`. The HTML is never cached long; hashed JS and CSS files are immutable (`_headers`).
- **Assets (R2 behind a small asset Worker).** Models, textures and audio under an immutable versioned path. A release never overwrites an existing version folder. The asset Worker sets the cache and CORS headers (spec 11) and counts requests per asset. It is built when the first assets ship.
- **Realtime Worker + Durable Objects.** One Durable Object per hall instance (`RoomDO`) holds presence and ritual state. One `DirectoryDO` aggregates counts for the room list and the temple-wide "today" counters. See [05 Server](05-server.md).
- **No database** in v1. Presence is in memory with WebSocket attachments. Lamps and counters live in Durable Object storage.

## Technology choices

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language for client, server and protocol |
| Client build | Vite | Fast dev server, code splitting, hashed output |
| 3D | Three.js (pin an exact version at M0) | Mature WebGL renderer, glTF, KTX2, instancing |
| Asset compression | glTF-Transform, meshopt, KTX2 (Basis) | Small downloads, GPU-friendly textures |
| Audio | Web Audio API | Mixing, spatial bells, synced aarti playback |
| Realtime | Cloudflare Workers + Durable Objects with the WebSocket Hibernation API | One stateful object per room; idle rooms cost almost nothing |
| Hosting | Workers static assets + R2 | Edge-cached static files and assets, close to Indian users. Cloudflare is folding Pages into Workers, so the web app is a static-assets Worker |
| Tests | Vitest, `@cloudflare/vitest-pool-workers`, Playwright | Unit, Durable Object and browser tests |
| i18n | Small in-house string loader (JSON per locale) | No heavy framework needed for ~150 strings |

The client has no UI framework. The HUD is plain DOM plus CSS, which keeps the initial bundle small (budget in [10](10-performance.md)). If the UI grows, a small library MAY be added after a perf-auditor review.

## Repository layout

```
/
├─ CLAUDE.md
├─ .claude/                     settings, review agents, skills
├─ specs/                       these documents
├─ package.json                 npm workspaces, root scripts
├─ apps/
│  ├─ web/
│  │  ├─ index.html             boot screen + module script
│  │  ├─ src/
│  │  │  ├─ main.ts             boot, error screen, lazy-load scene
│  │  │  ├─ scene/              world, avatars, camera, lighting, LOD
│  │  │  ├─ rituals/            one module per ritual (03)
│  │  │  ├─ net/                WebSocket client, interpolation, clock sync
│  │  │  ├─ audio/              mixer, channels, aarti scheduler
│  │  │  ├─ ui/                 HUD, dialogs, onboarding
│  │  │  ├─ i18n/               en.json, hi.json, loader
│  │  │  └─ platform/           tab ownership, idle sleep, storage helpers
│  │  ├─ public/                _headers, .assetsignore, manifest.webmanifest, fonts
│  │  └─ wrangler.jsonc         static-assets Worker (no code)
│  └─ realtime/
│     ├─ src/
│     │  ├─ worker.ts           routes: /api/rooms, /ws, /api/beacon
│     │  ├─ room.ts             RoomDO
│     │  ├─ directory.ts        DirectoryDO
│     │  └─ rules/              movement, queues, mats, lamps, counters
│     └─ wrangler.jsonc
├─ packages/
│  └─ protocol/
│     └─ src/
│        ├─ constants.ts        every number from spec 04
│        ├─ messages.ts         message types
│        ├─ validate.ts         type guards (no dependencies)
│        ├─ world.ts            walkable areas, sacred zones, ritual spots (shared by client and server)
│        └─ schedule.ts         aarti times, IST helpers
├─ assets-src/                  source .blend/.wav/etc. + LICENSES.md (not shipped)
└─ tools/
   ├─ assets/                   optimise + manifest scripts
   ├─ bots/                     load-test clients
   └─ check/                    size budgets, spec link check
```

`packages/protocol/src/world.ts` is shared on purpose. The server uses the same walkable areas and sacred zones as the client, so it can correct positions.

## Environments

| Env | Web | Realtime | Assets | Notes |
|---|---|---|---|---|
| local | `vite` on `http://localhost:5173` | `wrangler dev` on `http://localhost:8787` | served from `apps/web/public` or local R2 | Origin `http://localhost:5173` allowed |
| staging | `sannidhi-web-staging.<account>.workers.dev` / `staging.<domain>` | Worker env `staging` | R2 bucket `sannidhi-assets-staging` | Real Cloudflare, test data |
| production | `<domain>` (until then `sannidhi-web-production.<account>.workers.dev`) | Worker env `production` | R2 bucket `sannidhi-assets` | Deploys only through the `release` skill |

Configuration the client needs (realtime URL, asset origin, analytics token, UPI details) comes from Vite env variables at build time. Secrets are never shipped to the client. The server has no secrets in v1 apart from Cloudflare's own bindings.

- **Realtime URL:** `VITE_REALTIME_URL`. Local dev defaults to `http://localhost:8787`. `npm run deploy:web` sets it from `REALTIME_URLS` in `tools/deploy/target.ts`, so a staging build always talks to the staging realtime Worker.

## Boot sequence

1. `index.html` shows a static boot screen with no JS dependency. A CSS-only retry link appears after 15 s.
2. `main.ts` (small) checks for WebGL2. If it's missing, it shows a respectful "This device can't show the temple" page with an audio-only aarti option.
3. `main.ts` lazy-loads the scene bundle, then fetches the asset manifest, then loads the **first-view assets** (gate, path, low LOD trees) before anything else.
4. In parallel it calls `GET /api/rooms`, picks a hall, and opens the WebSocket.
5. The temple becomes interactive. Remaining assets stream in by priority (spec 10).

## Acceptance criteria

- `npm run dev` starts web and realtime locally, and two browser windows can see each other.
- Building the web app produces hashed JS and CSS. The HTML references only hashed files.
- No asset URL in client code is hard-coded. All go through the manifest.
- Each environment's config is set by env variables, and staging can't connect to the production realtime Worker.

## Open decisions

1. Durable Object location hint. Default `apac` because most visitors are in India. Revisit if diaspora traffic is large.
