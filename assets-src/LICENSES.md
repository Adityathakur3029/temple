# Asset licences

One entry per shipped file, in the format of [spec 11 § Licensing rules](../specs/11-assets-and-licensing.md#licensing-rules). `npm run assets:build` and `npm run check` fail if a model in `slots.json` has no entry here.

Allowed: our own work (including commissioned work with a written licence), CC0, CC-BY 4.0 with credit, OFL for fonts. Not allowed: CC-BY-NC, CC-BY-ND, "personal use only", or anything without a traceable source.

<!--
Template for a downloaded model:

## models/bell.glb
- Source: <page URL>
- Author: <name>
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "<title>" by <author>, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no
- For the linga, Nandi or Ganesha also:
  - How human authorship was checked: <for example the author's other work, process images>
  - Not a scan or copy of a real temple's murti: <how checked>
- Modified: fitted, simplified and re-encoded for Sannidhi
-->

## models/bell.glb
- Source: https://sketchfab.com/3d-models/temple-bell-f02512bfbb1847acb7142d0883d73c4e
- Author: Srinuart (https://sketchfab.com/srinuartabcd)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Temple Bell" by Srinuart, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no
- Modified: chain and hook removed (bell-only.gltf), then fitted, simplified and re-encoded for Sannidhi

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

## models/ganesha.glb
- Source: https://sketchfab.com/3d-models/ganesha-statue-4b19fcb66db049a89bf8d1dd3b0c733c
- Author: Arodin (https://sketchfab.com/Arodin)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Ganesha Statue" by Arodin, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no
- How human authorship was checked: the page says it was sculpted in ZBrush, decimated and cleaned up in Maya and textured in Substance Painter; the file's mesh is named "Ganesha_LP_cleanUV" (a hand-made low-poly with clean UVs); published 2018-03-01, before AI model generators
- Not a scan or copy of a real temple's murti: a digital sculpture, not a photo-scan; the page names no temple, museum or place
- Modified: fitted, simplified and re-encoded for Sannidhi

## models/tree.glb
- Source: https://sketchfab.com/3d-models/conifer-tree-050e3864cbaa4348b4e1da1fce4ecdce
- Author: Yurisaki3D (https://sketchfab.com/Yurisaki3D)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Conifer Tree" by Yurisaki3D, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no (made in Blender, 62 triangles)
- Modified: fitted and re-encoded for Sannidhi

## models/near-tree.glb
- Source: https://sketchfab.com/3d-models/pine-tree-e52769d653cd4e52a4acff3041961e65
- Author: Andriy Shekh (https://sketchfab.com/sheh5262)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Pine tree" by Andriy Shekh, CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: no (published 2020-10-17, tagged Blender, Substance and Photoshop; description "tried to make it look stylized")
- Modified: leaves changed from see-through to cut-out (pine-cutout.gltf), then fitted, simplified and re-encoded for Sannidhi

## models/post-lamp.glb
- Source: https://sketchfab.com/3d-models/golden-oil-lamp-1fba4e5a5ac8410ca7235673a3f269ba
- Author: biswajit3dcreator (https://sketchfab.com/biswajit3dcreator)
- Licence: CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Downloaded: 2026-11-05
- Credit line: "Golden Oil Lamp" by biswajit3dcreator, made with Meshy (AI), CC BY 4.0
- Interim: yes (a stand-in until final art in M5)
- AI-made: yes. The page says "This model was generated using Meshy" and is tagged "ai", "createdwithai" and "meshy" (published 2025-10-03). Allowed because it is a non-sacred prop with no deity figure or sacred symbol (spec 11 § AI-generated content); disclosed in the credit line. Meshy's terms still need checking before a public deploy
- Modified: the flame cut off above the wick (the flame is drawn in code), the texture baked into vertex colours and the texture dropped (lamp-no-flame.gltf), then fitted, simplified and re-encoded for Sannidhi

## models/gate.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/gate/make_gate.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Gate modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the gate is a non-sacred structure with no deity figure or sacred symbol (spec 11 § AI-generated content); disclosed in the credit line
- Modified: re-encoded by the asset build

## models/today-board.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/today-board/make_today_board.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Today board modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because it is a non-sacred prop with no text, deity figure or sacred symbol (spec 11 § AI-generated content); disclosed in the credit line
- Modified: re-encoded by the asset build

## models/deepa-stand.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/deepa-stand/make_deepa_stand.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Deepa stand and diyas modelled for Sannidhi by Claude (AI)
- Interim: yes (a stand-in until human-made final art, or the advisor's approval)
- AI-made: yes. Spec 08 asks for the deepa stand and the visitor's diya to be human-made or listed there first; the owner approved this AI-made stand-in on 2026-11-08 and it is listed in the spec 08 "AI-made lamps" row. Plain brass and clay, with no figure or symbol; disclosed in the credit line
- Modified: re-encoded by the asset build

## models/mandapa.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/mandapa/make_mandapa.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Mandapa modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the mandapa is a non-sacred structure with no deity figure, and no sacred symbol on its floor or steps (spec 11 § AI-generated content); its only sacred element is the brass kalasha on the roof. Disclosed in the credit line
- Modified: re-encoded by the asset build

## models/shrine.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/shrine/make_shrine.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Shrine modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the shrine building is a non-sacred structure: the sanctum is hollow and empty (the linga is its own human-made or downloaded slot), with no deity figure and no sacred symbol (spec 11 § AI-generated content); its only sacred element is the brass kalasha on top. Disclosed in the credit line
- Modified: re-encoded by the asset build

## models/ganesha-shrine.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/ganesha-shrine/make_ganesha_shrine.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Ganesha shrine modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the shrine is a non-sacred structure with an empty pedestal (the Ganesha murti is its own slot and is never AI-made, spec 08), with no deity figure and no sacred symbol (spec 11 § AI-generated content); its only sacred element is the small brass kalasha on top. Disclosed in the credit line
- Modified: re-encoded by the asset build

## models/kund.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/kund/make_kund.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Kund modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the kund is a non-sacred structure with no deity figure and no sacred symbol (spec 11 § AI-generated content); disclosed in the credit line
- Modified: re-encoded by the asset build

## models/avatar.glb
- Source: own. Made for Sannidhi by Claude (AI) in Blender 5.2 on 2026-11-08, with the script assets-src/models/avatar/make_avatar.py, which rebuilds it
- Author: Claude (Anthropic), for the Sannidhi project
- Licence: own
- Credit line: Devotee figure modelled for Sannidhi by Claude (AI)
- Interim: yes (until final art in M5, or until it is accepted as final)
- AI-made: yes. Allowed because the devotee figure is not a deity, sacred form or sacred symbol (spec 11 § AI-generated content); it carries no caste, sect or regional marker (spec 08); disclosed in the credit line
- Modified: re-encoded by the asset build
