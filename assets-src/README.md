# Source assets

Models, sounds and images before they are optimised. Nothing in this folder is shipped to visitors. The rules are in [spec 11](../specs/11-assets-and-licensing.md); the `add-asset` skill is the checklist.

## Putting a model in the temple

Every piece of the temple that a model can replace is a **slot**: `gate`, `bell`, `nandi` and so on. The full list, with sizes and budgets, is in [spec 11 § Slots](../specs/11-assets-and-licensing.md#slots). A slot without a model shows its grey placeholder shape.

1. Put the file in `assets-src/models/<slot>/`, for example `assets-src/models/bell/temple-bell.glb`. GLB or glTF only.
2. Add an entry to `assets-src/LICENSES.md` (source page, author, licence, date).
3. Add the slot to `slots.json`:

   ```json
   {
     "slots": {
       "bell": {
         "file": "models/bell/temple-bell.glb",
         "licence": "CC-BY-4.0",
         "credit": "\"Temple bell\" by A. Person, CC BY 4.0",
         "interim": true
       }
     }
   }
   ```

   Optional settings: `"rotate": [x, y, z]` in degrees if the model faces the wrong way, `"scale"` to make it bigger or smaller after fitting, `"offset": [x, y, z]` in metres to nudge it, `"fit": "none"` for a model already made to the slot's exact size and origin, `"ai": true` if an AI tool made it (for sacred slots, only a local test model, which `npm run deploy:web` refuses), and `"notes"`.

4. Run `npm run assets:build`. It sizes the model to its slot, shrinks it to the slot's budget, packs Full and Lite versions and writes the manifest. It stops with a plain message if something doesn't fit.
5. Run `npm run dev` and look at it in the temple, then `npm run check`.

## Putting a sound in the temple

Sounds work the same way. The list of sounds, with how many variants each may have, is in [spec 11 § Sounds](../specs/11-assets-and-licensing.md#sounds).

1. Put the clip in `assets-src/audio/<sound>/`, for example `assets-src/audio/bell/bell-1.wav`. WAV is best; FLAC or MP3 also work. Volume doesn't matter, the build sets it.
2. Add an entry to `assets-src/LICENSES.md` for each variant: `## audio/bell-1.m4a`, `## audio/bell-2.m4a` and so on.
3. Add the sound to `sounds.json`:

   ```json
   {
     "sounds": {
       "bell": {
         "files": ["audio/bell/bell-1.wav", "audio/bell/bell-2.wav"],
         "licence": "own",
         "credit": "Bell sounds made for Sannidhi with ElevenLabs (AI)",
         "interim": true,
         "ai": true
       }
     }
   }
   ```

4. Run `npm run assets:build`. It mixes each clip to mono, sets its level, and makes a small `.m4a` file.
5. Run `npm run dev`, turn sound on with the bell button (or `M`), and ring a bell.

### The linga, Nandi and Ganesha

A downloaded model may stand in for these until the final ones are made for Sannidhi, on the conditions in [spec 08 § Depiction](../specs/08-cultural-guidelines.md#depiction). In short: a person made it (never AI, except a local test model that is never deployed), its licence allows our use, it follows the depiction rules (for example the linga aniconic in plain dark stone, Nandi calm and traditional, Ganesha never cartoon or "cute"), and it isn't a copy or scan of a real temple's murti. In `slots.json` write `"ai": false` and keep `"interim": true`; the build refuses it otherwise. Add it to the spec 08 check-with-advisor list in the same change and ask for a cultural review. The shrine and Ganesha shrine slots are meant to be empty, so pick models with no deity figure inside.

To replace a stand-in with an artist's model, change `file`, the licence and the credit, set `"interim": false`, and build again. To go back to the grey shape, remove the slot from `slots.json` and build again.
