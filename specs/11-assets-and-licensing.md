# 11 — Assets and licensing

## Purpose

Every model, texture, image, sound and font the temple ships: what exists, the budgets, how files are built, how they are found at runtime, and how each is licensed and credited. The `add-asset` skill is the step-by-step version; [assets-src/README.md](../assets-src/README.md) is the short guide to putting a model in the temple.

## Asset list and budgets

Triangle counts are per instance. Texture sizes are given as Full / Lite.

| Asset | Triangles | Textures | Notes |
|---|---|---|---|
| Devotee avatar (rig + 2 body variants) | LOD0 ≤ 6k, LOD1 ≤ 1.5k, LOD2 ≤ 300 | 512² / 256² atlas; shawl colour from an 8-colour palette uniform | Clips: idle, walk, namaste, pranam, sit, japa (sit/stand), bell, diya, pour, take aarti, prasad. LOD1/LOD2 baked to vertex animation textures |
| Garbhagriha + shikhara + antarala | ≤ 45k | Stone trim sheets 2K / 1K | Amalaka and kalasha on top; the somasutra spout on the north wall |
| Shiva linga, yoni pitha, dharapatra | ≤ 6k | 1K / 512 | Human-made; a downloaded stand-in MAY be used until M5 (spec 08 § Depiction); advisor review. Tag `sacred` |
| Nandi (the figure; its platform stays in the stone kit for now) | ≤ 8k | 1K / 512 | As the linga. Tag `sacred` |
| Ganesha murti | ≤ 6k | 1K / 512 | As the linga. Tag `sacred` |
| Ganesha shrine (small open shrine and pedestal) | ≤ 4k | 1K / 512 | Shares the shrine trim sheets |
| Mandapa (pillars, beams, roof, plinth) | ≤ 30k | Shares the shrine trim sheets | 12 pillars |
| Mats ×40 | ≤ 100 each | Shared 256² | Instanced |
| Bells ×11 + chains | ≤ 800 each | Shared brass 512² | Swing animation in code |
| Deepa stand (108 cups) | ≤ 15k | 1K / 512 | Flames are instanced sprites (spec 10) |
| Aarti plate, lota, matchbox, mala, prasad | ≤ 3k each | Shared props atlas 1K / 512 | |
| Kund (stepped tank) | ≤ 8k | Stone trim + simple water shader | |
| Path, steps, walls, gate (modular kit) | ≤ 40k total | Stone trim sheets | The gate (torana) is its own slot, ≤ 15k of the 40k |
| Deodar trees ×3 variants | LOD0 ≤ 5k, LOD1 ≤ 1k, impostor 2 | 1K / 512 per variant | Up to 300 instances (120 in Lite mode and on Low phones). Until tree LODs exist (M5), the `tree` slot takes one model of ≤ 120 triangles, the same as the greybox tree; solid low-poly foliage is cheaper than alpha-cut leaves |
| Rocks, ferns, moss kit | ≤ 2k each | Shared 1K / 512 | Instanced |
| Sky and far mountains | Shader + 1 panorama | 4096×1024 / 2048×512 | Snow peaks, no recognisable real mountain |
| Footwear rack, today board, lanterns | ≤ 3k each | Props atlas | The today board text is rendered in code, not baked |
| Footwear pair (one per visitor present) | ≤ 300 | Props atlas 512 / 256 | Plain chappals; instanced on the rack shelves |
| UI icon set | SVG | — | Original: shikhara, diya, bell, mala, joined hands, a bowing figure with joined hands raised, people (for "Who's here"), eye, settings (sliders). **No deity faces** |
| App icon, favicon, social image | PNG/SVG | — | Shikhara silhouette at dawn, or a diya. No deity image |
| Fonts | — | — | Noto Sans, Noto Sans Devanagari, Tiro Devanagari Hindi (OFL); subset WOFF2 |
| Audio | — | — | See the list in spec 06; formats and loudness per spec 06 |

## Formats

- **Models:** glTF 2.0 binary (`.glb`), compressed with meshopt (`EXT_meshopt_compression`), with quantised attributes. Animations are resampled and keyframes deduplicated.
- **Textures:**
  - KTX2 (`KHR_texture_basisu`): UASTC for normal maps, ETC1S for colour and ORM.
  - Mipmaps are on. Power-of-two sizes only.
  - **Until the lighting pass (M5)** adds an environment map, the client draws models with the same matte (Lambert) lighting as the greybox, which is also the cheapest on Low phones. So the build keeps only colour textures (base colour, emissive) as ETC1S, and drops normal, occlusion and metal/roughness maps.
- **Images in the UI:** SVG where possible; otherwise WebP with a PNG fallback only where required.
- **Audio:** AAC-LC `.m4a` (spec 06).

## Pipeline (`tools/assets`)

1. **Source** lives in `assets-src/<kind>/<name>/` (`.blend`, `.wav`, layered images, a downloaded `.glb` or `.gltf`). It is never shipped.
2. **Export** from Blender as glTF 2.0 with +Y up, metres, applied transforms, and no cameras or lights.
3. **Config:** `assets-src/slots.json` says which source file fills which slot (§ Slots). Each entry has its `licence`, `credit`, `interim` (a stand-in until final art) and `ai` flags, and how to fit it: `fit` (`auto` or `none`), `rotate` (degrees about x, then y, then z), `scale` and `offset` (metres). Unknown slots or settings fail the build.
4. **Build:** `npm run assets:build`, for each configured slot:
   - removes animations, rigs, morph targets, cameras, lights, non-triangle geometry and unsupported extensions;
   - turns and fits the model to its slot;
   - runs glTF-Transform (dedup, palette, join, weld, prune), and simplifies with meshoptimizer if the model is over its triangle budget. It fails if simplifying can't reach the budget, or if more materials are left than the slot's draw budget;
   - resizes textures to power-of-two sizes within the tier limit (rounded down, unless within 10% of the next size up) and encodes them to KTX2 with `ktx2-encoder` (Basis Universal compiled to WebAssembly, so nothing needs installing, on Windows or Linux);
   - compresses geometry with meshopt, with quantised attributes.
5. **Tiers:** the build writes `full/` and `lite/` variants. Lite has the smaller textures and aims for half the triangles; sacred forms keep their full detail. Lite models go to Lite mode and to Low phones (spec 10).
6. **Output:** the build hashes every file, writes the files under `apps/web/public/v/<release>/` and the manifest (below), and removes older local release folders. Nothing is written unless every slot builds.
7. **Budgets:** `npm run check` compares sizes, triangle counts and draw counts with this spec and fails on overruns.

Scripts are Node and cross-platform. They don't depend on bash. The build is deterministic: the same inputs give the same files and the same release.

## Slots

A **slot** is a named piece of the temple that a model can fill. A slot without a model, or whose model fails to load, shows its greybox shape, so the temple always works. Values live in `apps/web/src/assets/slots.ts`; this table mirrors it.

Coordinates are metres with +y up and the linga at the origin. +z points from the sanctum towards the gate (east), and +x is north. A model's front faces +z, the glTF convention; the turn in "Placed at" is applied in the temple.

| Slot | What goes there | Fitted to | Placed at (origin point) | Triangles / draws | Priority |
|---|---|---|---|---|---|
| `gate` | The torana: two pillars, the lintel and its small tower (not the walls); no carved deity figures | 5.6 m wide (x) | Bottom centre at (0, 0, 58) | 15k / 2 | P0 |
| `footwear-rack` | Wooden rack outside the gate, shelves at 0.08, 0.36, 0.64 and 0.92 m | 3.6 m wide | Bottom centre at (−3, 0, 61) | 3k / 1 | P0 |
| `today-board` | The painted board, blank (its text is drawn in code) | 2.02 m tall | Bottom centre at (3, 0, 56), front turned to −x (the path) | 3k / 1 | P0 |
| `footwear` | One pair of plain chappals side by side, toes to +z | 0.23 m wide | Bottom centre; one pair on the rack per visitor present | 300 / 1 | P0 |
| `tree` | A deodar | 10.4 m tall | Base centre; up to 300 placed in code (120 in Lite mode and on Low phones) | 120 / 2 | P0 |
| `shrine` | Garbhagriha, antarala and shikhara with amalaka and kalasha, and the somasutra spout. Hollow and empty sanctum (no linga, murti or Nandi inside, no carved deity figures), door to +z, floor at 0.45 m | 16.1 m tall | Bottom centre at (0, 0, 1.26) | 45k / 3 | P1 |
| `linga` | Linga on its yoni pitha, in plain dark stone: aniconic, no face, eyes or painted marks, a few bilva leaves or flowers at most. No dharapatra (it would change the fitted height; it comes later as its own piece). Its front (+z) is the spout | 0.92 m tall | Bottom centre on the sanctum floor (0, 0.465, 0), spout turned north (+x) | 6k / 2 | P1, `sacred` |
| `nandi` | Nandi: a traditional seated bull with natural proportions, calm, no cartoon style, no rider; the figure only | 1.6 m long (z) | Bottom centre on the platform (0, 0.5, 22.05), turned to face the sanctum (−z) | 8k / 2 | P1, `sacred` |
| `mandapa` | Open hall: plinth at 0.45 m, steps to +z, 12 pillars, beams, stepped roof; no carved deity figures, no sacred symbols on floors or steps | 15.2 m wide | Bottom centre at (0, 0, 12.1) | 30k / 3 | P1 |
| `ganesha-shrine` | Small open-fronted shrine, pedestal top at 0.75 m, empty (no murti), opening to +z | 3.9 m tall | Bottom centre at (−5.3, 0, 52), opening turned to +x | 4k / 2 | P1 |
| `ganesha` | A small traditional seated Ganesha murti, facing +z; not cartoon, "cute", toy-like or modern stylised | 0.71 m tall | Bottom centre on the pedestal (−5.375, 0.75, 52), turned to face +x | 6k / 2 | P1, `sacred` |
| `kund` | Square stepped tank: rim at ground level, three 0.6 m steps each 0.25 m lower; no sacred symbols | 10 m wide | Top centre at (16, 0.04, 32) | 8k / 2 | P1 |
| `deepa-stand` | Tall brass stand in tiers (the flames are drawn in code) | 2.35 m tall | Bottom centre at (−8.5, 0, 25) | 15k / 2 | P2 |
| `aarti-plate` | Wooden stand with a brass aarti plate | 0.89 m tall | Bottom centre at (2.2, 0, 20.5) | 3k / 1 | P2 |
| `bell` | A brass bell, hanging from its top (the chain is drawn in code) | 0.32 m tall | Top centre; hung at the 11 bell points, larger at the gate and in the mandapa | 800 / 1 | P2 |
| `mat` | A plain woven mat, 0.7 m wide (x) and 0.8 m deep (z); no sacred symbols | 0.7 m wide | Bottom centre; one at each of the 40 mat spots | 100 / 1 | P2 |

Textures follow the asset list above: 2K / 1K for the shrine, mandapa, kund and gate; 512 / 256 for the bell and footwear; 256 for mats; 1K / 512 for the rest.

- **Fitting:** with `fit: "auto"` (the default) the build turns the model by `rotate`, scales it evenly so its bounding box measures the "Fitted to" size, moves the origin point of the box (bottom or top centre) to the model's origin, then applies `scale` and `offset`. Use `fit: "none"` for models made in metres to this table.
- **Walking doesn't change:** where visitors can walk, sit and stand comes from `world.ts` (spec 02), whatever a model looks like. A model has to line up with it, for example the mandapa's pillars with the 12 pillar positions and its floor at 0.45 m, or it will look wrong.
- **Stays in code:** the ground, paving, paths, kerbs and walls, the Nandi platform, the somasutra channel and bridge, the kund water, lamps with their brackets and flames, bell chains and posts, the far mountains, the sky and the avatars. The avatar isn't a slot yet, because it needs the clips in the asset list.
- **Draw calls:** a single slot's model is drawn on its own, one draw call per material. An instanced slot's model replaces the greybox instanced mesh's geometry, so all its copies together cost one draw call per material. The draw budgets above add up to 28, which keeps the Low tier within spec 10 with 50 avatars. A transparent double-sided material is drawn in one pass, so it also costs one.
- **All models together:** `npm run check` adds up every model's triangles times its copies, and every texture's GPU memory, per tier, against what spec 10 leaves for models (`MODEL_TRIANGLES`, `MODEL_TEXTURE_BYTES` in `slots.ts`).
- **Taps:** tap-to-walk tests the greybox shapes as first built, not the models, so a tap stays cheap.
- **Loading:** by priority (spec 10 § Loading priority), after the scene code. A model replaces its greybox shape as soon as it arrives.

## Manifest

The client loads assets only through the manifest. No asset URL is written into code. The build writes the manifest to `apps/web/src/assets/manifest.json` and the scene code includes it, so it always matches the app version and costs no extra request.

```json
{
  "release": "3f9c2a1d",
  "inputs": "9b1e0c7a2f4d6e81",
  "files": [
    {
      "src": "models/nandi.glb",
      "slot": "nandi",
      "tier": "full",
      "path": "/v/3f9c2a1d/full/models/nandi.glb",
      "sha256": "…64 hex…",
      "bytes": 412345,
      "priority": "P1",
      "tags": ["nandi", "sacred", "interim"],
      "licence": "CC-BY-4.0",
      "credit": "\"Nandi\" by <author>, CC BY 4.0",
      "triangles": 7980,
      "draws": 1,
      "textures": [[1024, 1024]],
      "gpuBytes": 1398101
    }
  ]
}
```

- **`release`** is a short hash of the manifest's file list and hashes. A changed asset gives a new release folder. Old folders are never overwritten or deleted while a deployed app version still references them. It is `null` while no model is configured.
- **`inputs`** hashes the config, every file in each model's source folder, the slot table and the build settings. `npm run check` fails when it no longer matches, which means the models need building again.
- **Origin:** set by `VITE_ASSET_ORIGIN` at build time (spec 01). Until the asset Worker exists it is empty, and the web Worker serves the files under `/v/` with the immutable cache header in `apps/web/public/_headers`. The web Worker only has the current release, so a visitor still on an older app version sees greybox shapes until they reload.
- **`priority`** follows the loading order in spec 10.
- **`tags`** are the slot id, `sacred` for deity and sacred-object assets, `interim` for stand-ins and `ai` for AI-made assets. Only scene code (`apps/web/src/scene`, `apps/web/src/assets`) may load the manifest or a model, and `npm run check` fails otherwise, so no `sacred` asset can reach UI icon, favicon, loading or donation code (spec 08).
- **Caching:** responses use `cache-control: public, max-age=31536000, immutable` and `access-control-allow-origin` set to the app origins.
- **Integrity:** the client MAY verify `sha256` for P0 assets when `crypto.subtle` is available. A mismatch logs `boot_error` and refetches once.

## Licensing rules

| Allowed | Not allowed |
|---|---|
| Our own work (made by the team or commissioned with a written licence) | CC-BY-NC, CC-BY-ND, "personal use only" |
| CC0 (for example Poly Haven, ambientCG) | Film, TV, YouTube or music-label recordings without a licence |
| CC-BY 4.0 with credit | Anything with an unknown source |
| OFL fonts | Assets "inspired by" a specific real temple's idol or signage |

Commissioned work needs a written licence that covers a perpetual, worldwide right to use it on the website and in promotion, including while the site accepts donations.

**Downloaded models** (from Sketchfab, Poly Haven and similar sites) are allowed as stand-ins when the licence is CC0 or CC-BY 4.0. Record the source page, author, licence and date in `assets-src/LICENSES.md` before configuring the model; the build fails without that entry. Mark the model `interim` until final art replaces it. This includes the linga, Nandi and Ganesha, on the conditions in spec 08 § Depiction: for these the config must say `"ai": false`, and the build refuses one that isn't `interim` unless its licence is `own`.

**AI-generated content:**
- MAY be used only for non-sacred textures and props, where the tool's terms allow this use. It is disclosed in the credits.
- MUST NOT be used for the linga, Nandi, Ganesha, sacred symbols, the aarti or mantra audio.

### `assets-src/LICENSES.md` entry format

```
## models/avatar.glb
- Source: own (modelled by <name>, 2026-11)
- Licence: own
- Credit: none required

## audio/bell-1.m4a
- Source: <URL>
- Author: <name>
- Licence: CC-BY 4.0 (<licence URL>)
- Downloaded: 2026-11-10
- Credit line: "Temple bell" by <author>, CC BY 4.0
```

## Credits

The in-app credits screen (spec 07) is generated from the manifest's `credit` fields plus the font licences and "Made with Three.js". It is shown in the viewer's language, with the original titles kept as they are.

- **Sacred forms:** the credit gives the author, source and licence. Include the original title only if it fits the tone rules in spec 07; titles such as "FREE Shiva Lingam" or "cute Ganesha" are left out (CC BY 4.0 doesn't require the title).
- **Modified:** every built model is fitted, simplified and re-encoded, so CC-BY credits say "modified", as CC BY 4.0 requires.

## Acceptance criteria

- Every shipped file appears in the manifest with `sha256`, `bytes`, `tier`, `priority`, `licence`, `tags`, `triangles` and `draws`.
- Every manifest entry with a licence other than `own`/`CC0`/`OFL` has a non-empty `credit`, and the credits screen shows it.
- `npm run check` fails when:
  - an asset exceeds its triangle, draw or size budget;
  - a built file doesn't match its manifest entry, or `assets-src/` changed since the last build;
  - a configured model has no `LICENSES.md` entry, or a CC-BY model has no credit;
  - a sacred slot's config doesn't say `"ai": false`, or a downloaded sacred form isn't `interim`;
  - web code outside the scene loads the manifest or a model, or names a built model's path (spec 08). The favicon and app icon are checked by review.
- A slot without a model, or whose model fails to load, shows its greybox shape.
- Lite-tier scene bytes ≤ 5 MB and Full-tier ≤ 12 MB (spec 10).

## Open decisions

1. **Who models the sacred assets** (linga, Nandi, Ganesha), and the budget for them. Until then, downloaded stand-ins MAY be used (decided by the owner, 2026-11-05; spec 08 § Depiction).

The asset origin is decided: R2 behind a small asset Worker (spec 01, decided 2026-11-04).
