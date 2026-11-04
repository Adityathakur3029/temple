---
name: add-asset
description: Add or replace a 3D model, texture, environment map, image or sound in Sannidhi. Use whenever a file will be shipped to visitors. Covers licence check, optimisation, budgets, the hashed manifest entry and the credits page, following specs/11-assets-and-licensing.md.
---

# Add an asset

Every shipped file needs a known licence, an optimised build, a manifest entry and a credit. Follow `specs/11-assets-and-licensing.md`. This skill is the short version.

## 1. Licence
- **Allowed:** our own work, CC0, CC-BY 4.0 (credit required), or a written licence from the creator that allows use on a donation-supported website.
- **Not allowed:** CC-BY-NC or ND, "free for personal use", ripped film, TV or YouTube audio, devotional-label recordings without a licence, or anything without a traceable source.
- Record the source URL, author, licence and download date in `assets-src/LICENSES.md`.
- For any depiction of a deity or sacred object, check `specs/08-cultural-guidelines.md` before modelling or importing it.

## 2. Source file
- Put the source file under `assets-src/<kind>/<name>/`: `.blend`, `.wav`, or a full-resolution image.
- Source files are not shipped.

## 3. Optimise (`tools/assets`)
- **Models:** export glTF 2.0 (`.glb`), then run the pipeline script. It runs glTF-Transform: dedup, prune, weld, meshopt compression, KTX2 textures. Meet the triangle and LOD budget for the asset type in spec 11.
- **Textures:** KTX2. Use UASTC for normal maps and ETC1S for colour and roughness. Produce the tier sizes spec 11 lists: Full and Lite.
- **Audio:**
  - Music and chants: AAC-LC `.m4a`, 96 kbps stereo.
  - Effects: AAC-LC `.m4a`, 64 kbps mono.
  - Loudness-normalise to the target in spec 06.

## 4. Manifest
- Run the manifest script. It computes SHA-256 and byte size and writes the entry with `src`, `path` (versioned), `sha256`, `bytes`, `tier`, `licence` and `credit`.
- Code loads assets only through the manifest lookup, never by a hard-coded URL.

## 5. Budgets
- Run `npm run check`. The size-budget step fails if the full or Lite scene goes over budget.
- For a model or texture, ask the `perf-auditor` agent to check the change.

## 6. Credits
- Add the credit line, in both languages if it has words to translate, to the in-app credits list described in spec 07.
- CC-BY assets must show author, title, source link and licence link.
