# 10 — Performance

## Purpose

Most visitors use mid-range or budget Android phones on 4G with prepaid data. These budgets are hard limits. `npm run check` enforces the size budgets, and the `perf-auditor` agent reviews changes against the rest.

## Device tiers

| Tier | Typical device | Render scale | Target |
|---|---|---|---|
| Low | 2–3 GB RAM, Mali-G52 / Adreno 506 class, 2019–2021 budget phones | 0.7 | 30 fps |
| Mid | 4–6 GB RAM, Mali-G57 / Adreno 610–619 class | 0.85–1.0 | 30 fps steady, 60 where possible |
| High | Recent flagships, laptops, desktops | 1.0 (DPR capped at 2) | 60 fps |

- **Tier choice:** start from `navigator.deviceMemory`, the WebGL renderer string and `hardwareConcurrency`, taking the lowest tier any of them suggests:
  - GPU: the classes in the table above. Software renderers (SwiftShader, llvmpipe) count as Low. An unknown GPU counts as Mid on a phone and High elsewhere.
  - Memory: 2 GB or less is Low; 4 GB or less is at most Mid.
  - Cores: 2 or fewer is Low; 4 or fewer is at most Mid.
- **Render scale** multiplies the device pixel ratio after capping it at 2.
- **Adjustment:** after 10 s, measure the average frame time. Drop a tier if it's under target (below 90% of the target frame rate), then measure again. Suggest Lite mode (spec 07) on Low.
- **Override:** the visitor can choose a tier in Settings.

## Download budgets

| Item | Budget (compressed over the wire) |
|---|---|
| HTML + inline critical CSS | ≤ 15 KB |
| Boot JS (`main.ts` chunk) | ≤ 30 KB gzip |
| All JS (boot + scene + UI) | ≤ 350 KB gzip |
| Fonts needed for first view (one language) | ≤ 120 KB |
| First-view assets (gate, nearby path, sky, own avatar, low-LOD trees) | ≤ 2.5 MB |
| **Total before the temple is interactive** | **≤ 3 MB** |
| Full scene, Full tier (everything except aarti audio) | ≤ 12 MB |
| Full scene, Lite tier | ≤ 5 MB |
| Aarti recording (loaded only when sound is on) | ≤ 6 MB per recording |

**Time to interactive (cold cache):**
- Mid phone on typical 4G (≈ 10 Mbps, 100 ms RTT): ≤ 6 s.
- Low phone on slow 4G (≈ 4 Mbps): ≤ 10 s.
- Repeat visit (assets cached, immutable): ≤ 3 s.

## Loading priority

| Priority | Contents |
|---|---|
| P0 | First-view assets, UI fonts, the WebSocket connect (in parallel) |
| P1 | Shrine exterior, trees LOD1, Nandi, mandapa shell |
| P2 | Ritual props: deepa stand, bells, mats, lota, mala |
| P3 | Higher LODs, Full-tier textures, ambience |
| P4 | Aarti audio (from the 15-minute banner, only if sound is on) |

The temple is interactive after P0. Later priorities load in the background and never block input.

## Render budgets

| Metric | Low | Mid | High |
|---|---|---|---|
| Draw calls | ≤ 100 | ≤ 150 | ≤ 250 |
| Triangles on screen | ≤ 150k | ≤ 300k | ≤ 800k |
| GPU texture memory | ≤ 120 MB | ≤ 200 MB | ≤ 400 MB |
| JS heap | ≤ 120 MB | ≤ 150 MB | ≤ 250 MB |
| Real-time point lights (on top of the sun or moon and the sky's ambient light) | 2 | 4 | 4 |
| Shadows | Blob shadows | Blob shadows | One directional shadow map |
| Post-processing | None | None | Optional subtle bloom |

### Techniques the budgets assume

- **Remote avatars:**
  - Near (≤ 8 m, at most 8 avatars): a regular `SkinnedMesh` at LOD0.
  - Everyone else: one `InstancedMesh` per LOD with **vertex animation textures**, baked from the same clips, so all far avatars cost about one draw call per LOD.
- **Trees, rocks, ferns:** `InstancedMesh` with 3 LODs and impostor billboards for the farthest.
- **Diya flames (108):** one instanced emissive mesh plus additive sprites. No per-lamp lights.
- **Materials:** shared trim sheets for stone and wood. `ORM`-packed textures (occlusion, roughness, metalness).
- **Frame loop hygiene:** no allocations in the frame loop (reuse vectors and matrices). Animation mixers update only for LOD0 avatars.
- **Frustum culling** is left on, and the hierarchy is kept flat for static geometry (merged by region).

## Network and data budget

| Measure | Full | Lite |
|---|---|---|
| Average downstream per client | ≤ 3 KB/s | ≤ 1.5 KB/s |
| Peak downstream (busy instance, everyone walking) | ≤ 12 KB/s | ≤ 5 KB/s |
| Upstream | ≤ 1 KB/s | ≤ 0.5 KB/s |
| One-hour repeat visit, total including assets | ≤ 15 MB | ≤ 8 MB |

The compact delta tuples in spec 04, change-only sending and `LITE_TICK_HZ` are what make these numbers possible. If measurements exceed them, design the binary delta (spec 04).

## Background, tabs and idle

- **One rendering tab:**
  - Tabs coordinate through `BroadcastChannel`, with a `localStorage` fallback (`sannidhi:render-owner-v1`).
  - The most recently focused or interacted tab renders. Others stop their frame loop and show the rest overlay (spec 07).
- **Hidden tab:**
  - Stop the frame loop immediately.
  - Keep the socket for up to 2 minutes (so a quick app switch doesn't drop presence), then close it. The server holds the visitor's place for `RESUME_WINDOW_MS`.
- **Idle:**
  - After `IDLE_SLEEP_MS` without input while **seated, in the mala view, or during aarti**: calm mode. Render at 15 fps with the camera still, keeping presence.
  - Otherwise, after `IDLE_SLEEP_MS` without input: rest. Stop rendering, close the socket and show "Resting. Tap to return."
- **View restore:** `sessionStorage` `sannidhi:view-v1` (camera, the visitor's position, facing and mat, hall, instance, mala bead) is restored within `VIEW_CHECKPOINT_MS` after a reload. It is written every 2 s and when the page is hidden. A stored position that isn't walkable is ignored.

## Memory hygiene

- **Hall switch or exit:** dispose of geometries, materials, textures and render targets. Close `ImageBitmap`s.
- **Audio:** stop and disconnect unused audio nodes. Decoded effect buffers are kept (small). The aarti element is released after it ends.

## Measurement

- **Size budgets:** `npm run check` reads the Vite build manifest and the asset manifest, sums the bytes per budget line, and fails on any overrun.
  - Compressed sizes are measured as gzip level 9, with 1 KB counted as 1,000 bytes (stricter than 1,024). Already-compressed files (WOFF2, KTX2, `.m4a`) count at their file size.
  - CSS linked by the entry counts with the HTML. `.wasm` decoders count towards the total before interactive.
  - Lines that need the asset manifest report "not measured" until it exists. The checker lists any built file that no line counts.
- **Perf overlay:** `?perf=1` shows fps, frame time, draw calls, triangles, textures, geometries, JS heap, the tier and the pixel ratio.
- **CI perf run:** Playwright on the High tier with a 4× CPU throttle and an emulated 4G profile, recording time to interactive and the frame-time distribution while walking gate → mandapa.
- **Device matrix (manual, each milestone from M1):**
  - one Low Android (3 GB);
  - one Mid Android (4–6 GB);
  - one older iPhone (for example iPhone SE 2nd gen);
  - one laptop.

## Acceptance criteria

- `npm run check` passes all size budgets on the release build.
- On the Mid device: ≥ 30 fps p95 while walking with 49 remote avatars visible (bots), and time to interactive ≤ 6 s on 4G.
- On the Low device: ≥ 30 fps p90 in Lite mode with 49 remote avatars.
- A 50-bot instance measured from one client stays within the Full data budget averaged over 10 minutes.
- A hidden tab uses no `requestAnimationFrame` callbacks (checked in Playwright via a frame counter).

## Open decisions

1. **Instance capacity of 50.** Raise it if Mid-tier measurements allow (spec 04).
2. **Bloom on High.** Include it, or keep every tier identical apart from resolution?
3. **Restored position and the server (M2).** See [05 § Open decisions](05-server.md#open-decisions).
