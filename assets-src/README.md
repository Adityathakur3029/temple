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

   Optional settings: `"rotate": [x, y, z]` in degrees if the model faces the wrong way, `"scale"` to make it bigger or smaller after fitting, `"offset": [x, y, z]` in metres to nudge it, `"fit": "none"` for a model already made to the slot's exact size and origin, `"ai": true` if an AI tool made it (never allowed for sacred slots), and `"notes"`.

4. Run `npm run assets:build`. It sizes the model to its slot, shrinks it to the slot's budget, packs Full and Lite versions and writes the manifest. It stops with a plain message if something doesn't fit.
5. Run `npm run dev` and look at it in the temple, then `npm run check`.

### The linga, Nandi and Ganesha

A downloaded model may stand in for these until the final ones are made for Sannidhi, on the conditions in [spec 08 § Depiction](../specs/08-cultural-guidelines.md#depiction). In short: a person made it (never AI), its licence allows our use, it follows the depiction rules (for example the linga aniconic in plain dark stone, Nandi calm and traditional, Ganesha never cartoon or "cute"), and it isn't a copy or scan of a real temple's murti. In `slots.json` write `"ai": false` and keep `"interim": true`; the build refuses it otherwise. Add it to the spec 08 check-with-advisor list in the same change and ask for a cultural review. The shrine and Ganesha shrine slots are meant to be empty, so pick models with no deity figure inside.

To replace a stand-in with an artist's model, change `file`, the licence and the credit, set `"interim": false`, and build again. To go back to the grey shape, remove the slot from `slots.json` and build again.
