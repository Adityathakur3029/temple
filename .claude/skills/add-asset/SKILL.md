---
name: add-asset
description: Add or replace a 3D model, texture, environment map, image or sound in Sannidhi. Use whenever a file will be shipped to visitors. Covers licence check, optimisation, budgets, the hashed manifest entry and the credits page, following specs/11-assets-and-licensing.md.
---

# Add an asset

Every shipped file needs a known licence, an optimised build, a manifest entry and a credit. Follow `specs/11-assets-and-licensing.md`. This skill is the short version; `assets-src/README.md` is the owner's guide.

## 1. Licence
- **Allowed:** our own work, CC0, CC-BY 4.0 (credit required), or a written licence from the creator that allows use on a donation-supported website.
- **Not allowed:** CC-BY-NC or ND, "free for personal use", ripped film, TV or YouTube audio, devotional-label recordings without a licence, or anything without a traceable source.
- Record the source URL, author, licence and download date in `assets-src/LICENSES.md`, under a heading `## models/<slot>.glb`. The build fails without it.
- For any depiction of a deity or sacred object, check `specs/08-cultural-guidelines.md` § Depiction first. A downloaded linga, Nandi or Ganesha MAY stand in until M5 if a person made it, it follows § Depiction, it copies no real temple's murti, and it is marked `interim` with `"ai": false`. Never AI-made. Add it to the spec 08 check-with-advisor list in the same change, and ask the `cultural-reviewer` agent.
- A model for any other slot that includes a deity figure (a linga inside a shrine, a carved Ganesha on a lintel) is treated as sacred. Prefer removing the figure or choosing another model.
- Check the model isn't a specific real temple (spec 08: the temple is fictional).

## 2. Source file
- Put the source file under `assets-src/<kind>/<name>/`: a model in `assets-src/models/<slot>/` (`.glb` or `.gltf`), `.blend`, `.wav`, or a full-resolution image.
- Source files are not shipped.

## 3. Models: the slot
- Pick the slot in spec 11 § Slots (`apps/web/src/assets/slots.ts`). Read its "What goes there", size, origin and budgets.
- Add the slot to `assets-src/slots.json` with `file`, `licence`, `credit` (required unless own or CC0) and `interim`. Use `rotate`, `scale` and `offset` if the model faces the wrong way or sits wrong; `fit: "none"` for models made in metres to the slot's size and origin.
- A new kind of slot changes `slots.ts`, the greybox section in `scene/greybox.ts`, and spec 11 § Slots in the same change.

## 4. Build
- **Models:** `npm run assets:build`. It fits the model, joins and simplifies it to the slot's triangle and draw budgets, makes KTX2 (ETC1S) textures at the Full and Lite sizes with `ktx2-encoder` (nothing to install), compresses with meshopt and writes `apps/web/public/v/<release>/` and `apps/web/src/assets/manifest.json`. It stops with a plain message when something doesn't fit.
- **Audio:**
  - Music and chants: AAC-LC `.m4a`, 96 kbps stereo.
  - Effects: AAC-LC `.m4a`, 64 kbps mono.
  - Loudness-normalise to the target in spec 06.

## 5. Look at it
- `npm run dev`, walk to the slot and check the size, facing and that it lines up with the walkable areas (pillars, floor heights, steps). Try Lite mode too.
- Code loads assets only through the manifest (`scene/models.ts`), never by a hard-coded URL, and only scene code may load models.

## 6. Budgets
- Run `npm run check`. It fails if a model is over its slot's budgets, if the built files are stale, or if the full or Lite scene goes over budget.
- For a model or texture, ask the `perf-auditor` agent to check the change. For anything sacred or visible, ask the `cultural-reviewer` agent.

## 7. Credits
- Add the credit line, in both languages if it has words to translate, to the in-app credits list described in spec 07.
- CC-BY assets must show author, title, source link and licence link.
