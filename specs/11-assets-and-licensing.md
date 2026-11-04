# 11 — Assets and licensing

## Purpose

Every model, texture, image, sound and font the temple ships: what exists, the budgets, how files are built, how they are found at runtime, and how each is licensed and credited. The `add-asset` skill is the step-by-step version.

## Asset list and budgets

Triangle counts are per instance. Texture sizes are given as Full / Lite.

| Asset | Triangles | Textures | Notes |
|---|---|---|---|
| Devotee avatar (rig + 2 body variants) | LOD0 ≤ 6k, LOD1 ≤ 1.5k, LOD2 ≤ 300 | 512² / 256² atlas; shawl colour from an 8-colour palette uniform | Clips: idle, walk, namaste, pranam, sit, japa (sit/stand), bell, diya, pour, take aarti, prasad. LOD1/LOD2 baked to vertex animation textures |
| Garbhagriha + shikhara + antarala | ≤ 45k | Stone trim sheets 2K / 1K | Amalaka and kalasha on top; the somasutra spout on the north wall |
| Shiva linga, yoni pitha, dharapatra | ≤ 6k | 1K / 512 | Human-made; advisor review (spec 08). Tag `sacred` |
| Nandi on a platform | ≤ 8k | 1K / 512 | Human-made; advisor review. Tag `sacred` |
| Ganesha murti + small shrine | ≤ 10k | 1K / 512 | Human-made; advisor review. Tag `sacred` |
| Mandapa (pillars, beams, roof, plinth) | ≤ 30k | Shares the shrine trim sheets | 12 pillars |
| Mats ×40 | ≤ 100 each | Shared 256² | Instanced |
| Bells ×11 + chains | ≤ 800 each | Shared brass 512² | Swing animation in code |
| Deepa stand (108 cups) | ≤ 15k | 1K / 512 | Flames are instanced sprites (spec 10) |
| Aarti plate, lota, matchbox, mala, prasad | ≤ 3k each | Shared props atlas 1K / 512 | |
| Kund (stepped tank) | ≤ 8k | Stone trim + simple water shader | |
| Path, steps, walls, gate (modular kit) | ≤ 40k total | Stone trim sheets | |
| Deodar trees ×3 variants | LOD0 ≤ 5k, LOD1 ≤ 1k, impostor 2 | 1K / 512 per variant | Up to 300 instances (Lite 120) |
| Rocks, ferns, moss kit | ≤ 2k each | Shared 1K / 512 | Instanced |
| Sky and far mountains | Shader + 1 panorama | 4096×1024 / 2048×512 | Snow peaks, no recognisable real mountain |
| Footwear rack, today board, lanterns | ≤ 3k each | Props atlas | The today board text is rendered in code, not baked |
| UI icon set | SVG | — | Original: shikhara, diya, bell, mala, joined hands, eye, settings (sliders). **No deity faces** |
| App icon, favicon, social image | PNG/SVG | — | Shikhara silhouette at dawn, or a diya. No deity image |
| Fonts | — | — | Noto Sans, Noto Sans Devanagari, Tiro Devanagari Hindi (OFL); subset WOFF2 |
| Audio | — | — | See the list in spec 06; formats and loudness per spec 06 |

## Formats

- **Models:** glTF 2.0 binary (`.glb`), compressed with meshopt (`EXT_meshopt_compression`), with quantised attributes. Animations are resampled and keyframes deduplicated.
- **Textures:**
  - KTX2 (`KHR_texture_basisu`): UASTC for normal maps, ETC1S for colour and ORM.
  - Mipmaps are on. Power-of-two sizes only.
- **Images in the UI:** SVG where possible; otherwise WebP with a PNG fallback only where required.
- **Audio:** AAC-LC `.m4a` (spec 06).

## Pipeline (`tools/assets`)

1. **Source** lives in `assets-src/<kind>/<name>/` (`.blend`, `.wav`, layered images). It is never shipped.
2. **Export** from Blender as glTF 2.0 with +Y up, metres, applied transforms, and no cameras or lights.
3. **Build:** `npm run assets:build` runs glTF-Transform (dedup, prune, weld, resample, quantise, meshopt) and KTX2 encoding.
   - KTX2 encoding needs the KTX-Software `toktx` tool installed. On Windows, install the official release and make sure `toktx` is on `PATH`. The build script checks for it and explains how to install it if missing.
4. **Tiers:** the build writes `full/` and `lite/` variants.
5. **Manifest:** the build hashes every output file and writes the manifest (below).
6. **Budgets:** `npm run check` compares sizes and triangle counts with this spec and fails on overruns.

Scripts are Node and cross-platform. They don't depend on bash.

## Manifest

The client loads assets only through the manifest. No asset URL is written into code.

```json
{
  "release": "3f9c2a1d",
  "origin": "https://assets.<domain>",
  "files": [
    {
      "src": "models/avatar.glb",
      "tier": "full",
      "path": "/v/3f9c2a1d/full/models/avatar.glb",
      "sha256": "…64 hex…",
      "bytes": 412345,
      "priority": "P0",
      "tags": ["avatar"],
      "licence": "own",
      "credit": null
    }
  ]
}
```

- **`release`** is a short hash of the manifest's file list and hashes. A changed asset gives a new release folder. Old folders are never overwritten or deleted while a deployed app version still references them.
- **`priority`** follows the loading order in spec 10.
- **`tags`** include `sacred` for deity and sacred-object assets. A CI check fails if a `sacred`-tagged asset is referenced from UI icon, favicon, loading or donation code (spec 08).
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

## Acceptance criteria

- Every shipped file appears in the manifest with `sha256`, `bytes`, `tier`, `priority`, `licence` and `tags`.
- Every manifest entry with a licence other than `own`/`CC0`/`OFL` has a non-empty `credit`, and the credits screen shows it.
- `npm run check` fails when an asset exceeds its triangle or size budget, or when a `sacred` asset is used in a forbidden code path.
- Lite-tier scene bytes ≤ 5 MB and Full-tier ≤ 12 MB (spec 10).

## Open decisions

1. **Who models the sacred assets** (linga, Nandi, Ganesha), and the budget for them.

The asset origin is decided: R2 behind a small asset Worker (spec 01, decided 2026-11-04).
