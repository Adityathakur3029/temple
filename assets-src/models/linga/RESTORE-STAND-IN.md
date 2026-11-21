# Restoring the downloaded linga stand-in

The Claude-made linga (make_linga.py) is a local TEST MODEL and blocks npm run deploy:web. Before any deploy, put this slots.json entry back under slots.linga and this block back in assets-src/LICENSES.md, then run npm run assets:build.

## slots.json entry

```json
{
  "file": "models/linga/linga-plain.gltf",
  "licence": "CC-BY-4.0",
  "credit": "\"Shivling 3D Models\" by MANISH 3D MASTER, CC BY 4.0",
  "interim": true,
  "ai": false,
  "rotate": [
    0,
    90,
    0
  ],
  "offset": [
    0,
    0,
    0.137
  ],
  "notes": "linga-plain.gltf is scene.gltf (the Sketchfab download) with the white tripundra faces given the shaft's stone material (they are cut from the shaft surface and flush with it, so deleting them would leave a hole) and the red dot (a separate bead) removed: spec 08, no marks. Recoloured from pure black to the greybox stone colours. The spout points -x in the download, so it turns 90 degrees to face +z; the spout makes the box off-centre, so the offset moves the linga back to the slot's centre"
}
```

## LICENSES.md block

## models/linga.glb
- Source: https://sketchfab.com/3d-models/shivling-3d-models-11acada5a1e04bc9bf2f63c4bf158e03
- Author: MANISH 3D MASTER (https://sketchfab.com/Tigermrmanish2511)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Shivling 3D Models" by MANISH 3D MASTER, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no
- How human authorship was checked: built from Blender primitives (a "Cylinder" object, Blender's default material names), 2,614 triangles with plain colours and no textures
- Not a scan or copy of a real temple's murti: simple modelled shapes with no scan data; the page names no temple or place
- Modified: white tripundra faces given the shaft's stone material, red dot removed, recoloured from pure black to dark stone (linga-plain.gltf), then fitted, simplified and re-encoded for Sannidhi

