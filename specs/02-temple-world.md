# 02 — Temple world

## Purpose

The physical temple: layout, sacred zones, light, camera, controls and the visitor's avatar. Coordinates are in metres. `+x` is north, `+z` is east, and `+y` is up. The shrine faces east, and the linga sits at the origin. Yaw is in radians about `+y`: yaw 0 faces east (`+z`) and yaw π/2 faces north (`+x`), so yaw θ faces (x, z) = (sin θ, cos θ).

## Setting

A fictional small stone temple on a forested Himalayan ridge at about 2,000 m. Deodar cedars, mossy rocks and a spring-fed kund surround it, with snow peaks far behind. The forest grows the way a hillside forest does, not in even rows: 180 deodars (90 in Lite mode) in groves with open ground between them, along both sides of the gate path and round the compound, with a few on their own. Most are grown trees; some are young and slender, and a few broad old giants stand at least 12 m back from where visitors walk. No branch reaches over the paths, the gate walls, the bell posts with their lamps or the notice board, and the Ganesha shrine stands against open forest: no trunk within 3 m of it and no branch within 1 m. Every visitor sees the same forest. The style is North Indian Nagara: a square garbhagriha under a curved stone shikhara topped by an amalaka and kalasha, a short antarala, and an open pillared mandapa. The palette is weathered grey-brown stone, deodar green, saffron and marigold accents, and brass. The temple must not resemble any specific real temple closely enough to be mistaken for it (see [08](08-cultural-guidelines.md)).

## Layout

| Element | Position (x, z) | Size / notes |
|---|---|---|
| Garbhagriha (sanctum) with Shiva linga on a yoni pitha | (0, 0) | Inner 5 × 5 m, door facing +z. **Not walkable.** |
| Shikhara | over (0, 0) | ~16 m tall; the landmark visible from the gate |
| Jaladhari / somasutra outlet | north wall (2.6, 0) → channel to the forest edge (14.7, 0) | Visible stone spout, and a channel running north across the pradakshina path |
| Antarala and threshold | z 2.6 … 5 | The jal-offering spot is at the threshold, beside the door (see 03) |
| Mandapa (open hall) | x −7 … 7, z 5 … 19 | 12 pillars, raised plinth, two blocks of mats either side of a clear central aisle |
| Nandi on a platform, facing −z | (0, 22) | The **Nandi axis** x −1.2 … 1.2, z 0 … 22 is a no-stand, no-walk zone |
| Mandapa bells | (±2.2, 19.5) | Hung from the mandapa entrance beam |
| Courtyard | x −12 … 12, z 19 … 30 | Stone-paved |
| Deepa stand (108-lamp tiered stand) | (−8.5, 25) | Up to 4 visitors at a time stand at marked spots around it |
| Aarti plate stand (after aarti) | (2.2, 20.5) | Where visitors "take aarti" after the service |
| Pradakshina path | loop at x ±10.5, z −8 … 24 | Stone path around the shrine and mandapa; see [Pradakshina](#pradakshina-path) |
| Kund | centre (16, 32), 8 × 8 m | Stepped tank, not swimmable; the steps are walkable down to the second step |
| Path from the gate | z 30 … 46, straight along the axis (x = 0) | Lined with 8 hanging bells (`path-1` … `path-8`) and deodars. Each bell hangs from a wooden post just off the path, with a small brass oil lamp on a shelf facing the path |
| Ganesha shrine (small, open-fronted) | (−5, 42.4), just inside the gate, facing +x | Small murti; visitors may bow here (pranam is the only action) |
| Gate (torana) with gate bell | (0, 46) | Visitors arrive on the paved approach outside the gate, far enough out to see the whole torana, and walk in |
| Temple-wide "today" board | (3, 44.4) | Painted wooden board: diyas lit, malas completed, parikramas today |

These positions are the defaults for the greybox (M1). Final art MAY adjust them by up to 2 m without a spec change. Larger moves update this table and `packages/protocol/src/world.ts`.

## Sacred and blocked zones

These are defined in `packages/protocol/src/world.ts` and enforced by both client (collision) and server (position correction):

1. **Garbhagriha interior:** never enterable. The camera can't pass through the door either.
2. **Nandi axis:** the strip between Nandi and the sanctum door. Avatars walk around it, never across it, so the route to the threshold goes along the sides of the mandapa.
3. **Kund water:** the water and below the second step.
4. **Somasutra channel:** in half-pradakshina mode the channel is a blocking line from the shrine wall to the forest edge, so it can't be crossed on the path or walked around beside it (see below). In full mode only the bridge slab crosses it.
5. **Outside the boundary:** the forest edge is a soft wall about 3 m beyond the path.

## Pradakshina path

- A visitor walks the loop **clockwise, keeping the shrine on their right**: from the east side (in front of Nandi) to the south, then west, then north.
- **Mode `half-somasutra` (default):** the visitor walks clockwise up to the somasutra channel on the north side, does not cross it, and returns the same way to the east side. This follows the common North Indian practice for Shiva temples of not crossing the jaladhari. It is marked **check with advisor** in [08](08-cultural-guidelines.md).
- **Mode `full`:** a full clockwise loop, with the channel covered by a small bridge slab. This exists in case the advisor prefers it.
- **Checkpoints** for counting (server-side, see 03): `E` (0, 24), `S` (−10.5, 8), `W` (0, −8), `N` (10.5, −4) just before the channel, coming from `W`.

## Greybox details

The M1 greybox fixes these details in `world.ts`. Like the layout table, final art MAY move them by up to 2 m without a spec change.

| Item | Value |
|---|---|
| Walkable area | The compound inside the forest edge (x −14.7 … 14.7, z −12.2 … 30); a 1 m surround of the kund (x 11 … 21, z 27 … 37); the gate path, 3.6 m wide, straight along x = 0 from z 45.2 to z 30; the space in front of the Ganesha shrine (x −4.3 … −0.5, z 41 … 43.8); the area just inside the gate (x −2.6 … 2.6, z 42.4 … 46.3); and the approach outside the gate (x −1.8 … 1.8, z 46 … 55) |
| Raised plinth | The mandapa, antarala and sanctum share a 0.45 m plinth. The only way up is the steps along the mandapa's east side (z 19 … 20). Its other edges are blocked |
| Sanctum door | 1.5 m wide, centred on the axis in the east wall (z 2.6) |
| Antarala | x −2.6 … 2.6, z 2.6 … 5. Walkable only beside the axis (x 1.2 … 2.6 and −2.6 … −1.2) |
| Pillars | 0.5 m square, at x ±6.5 (z 5.6, 10, 14.4, 18.6) and x ±2.9 (z 5.6, 18.6) |
| Mats | Two blocks of 20 either side of the aisle: columns at x ±2.4, ±3.4, ±4.4, ±5.4 and rows at z 8.2, 9.6, 11, 12.4, 13.8. Mats 0–19 are the north block (+x) and 20–39 the south block, row by row from the front, inner column first. A seated visitor faces the linga |
| Jal spot | (1.9, 3.4), at the threshold on the north side of the door |
| Diya spots | 1.6 m north, east, south and west of the deepa stand's centre, each facing the stand |
| Path bells | `path-1` (−1.2, 44.4), `path-2` (1.2, 42.4), `path-3` (−1.2, 40.4), `path-4` (1.2, 38.4), `path-5` (−1.2, 36.4), `path-6` (1.2, 34.4), `path-7` (−1.2, 32.4), `path-8` (1.2, 30.4), 2 m apart on alternating sides, 1.2 m off the centre line. The gate bell hangs in the torana at (0, 46) |
| Spawn | (0, 53.5), on the approach 7.5 m outside the gate, facing it and the temple (−z); the camera starts straight behind the visitor |
| Kund steps | Each step is 0.6 m wide, so the water zone starts 1.2 m in from the rim: x 13.2 … 18.8, z 29.2 … 34.8 |
| Somasutra | A 0.7 m blocking strip along z = 0 from the north wall (x 2.6) to the forest edge (x 14.7). In `full` mode the bridge covers it at x 9.3 … 11.7 |
| Diya spots order | Spot 0 is north of the stand, then east, south and west |
| Other obstacles | Nandi's platform (x −1 … 1, z 21 … 23); the deepa stand (radius 0.8 m); the aarti plate stand (radius 0.3 m); the Ganesha shrine (x −6.3 … −4.3, z 41.3 … 43.5); the today board (x 2.8 … 3.2, z 43.6 … 45.2); the two gate pillars (radius 0.45 m at x ±2, the thick stone bases); and the plinth edges, 0.4 m strips outside the mandapa's north, south and west sides (from z 4.6) and the antarala's sides |

The server checks each step, the segment from a visitor's last accepted position to the new one, against these shapes ([05 § Movement rule](05-server.md#movement-rule-pos)). Every shape includes its edges, and where a walkable area meets a blocked one, the shared edge is blocked. The client keeps a 0.25 m body radius (`BODY_RADIUS`) clear of them, so a client that follows its own collision is never corrected.

## Light and time

- **Time of day follows IST.**

  | Phase | IST | Look |
  |---|---|---|
  | Night | 18:30–05:30 | Moon, lamp light, stars |
  | Dawn | 05:30–06:30 | Pink-gold sky |
  | Day | 06:30–17:30 | Sun over the ridge |
  | Dusk | 17:30–18:30 | Warm sky, lamps being lit |

  Each transition blends over the 10 minutes after the phase starts. Seasonal sunrise/sunset tables are a later option.
- **Preview:** `?ist=HH:MM` in the page URL shows the scene at that IST time, for review. It changes only the visitor's own view.
- **Lamps:** the deepa stand, sanctum lamps, path post lamps and lanterns use emissive materials and glow sprites. At most **4 real-time point lights** are active (sanctum, deepa stand, mandapa, gate). Lit diyas don't each get a light.
- **Shadows:** a single directional light with a small shadow map on High tier only. Baked ambient occlusion in textures on all tiers.
- **Weather:** clear by default. Seasonal snow (Dec–Feb) and monsoon mist (Jul–Sep) are a stretch goal (see Open decisions).

## Camera

- **Default:** third-person orbit behind the avatar. Distance 2.5–12 m (pinch or scroll), pitch −10° to +35°, eased follow.
- **Darshan view:** one tap frames the linga through the sanctum door from the mandapa. It is the default when seated on a mat, and the visitor can still look around a little (±25° yaw). The camera always looks from inside the mandapa. If the visitor is elsewhere, or too far to the side to see through the door, the camera takes the nearest place in the mandapa from which the linga is visible through the door.
- **Constraints:** the camera never enters the garbhagriha or clips through Nandi or pillars. It pulls in towards the avatar when blocked.
- **Reduced motion:** with `prefers-reduced-motion`, camera transitions cut instead of fly.

## Controls

| Platform | Move | Look | Zoom | Act |
|---|---|---|---|---|
| Touch | Tap the ground to walk there; or a left-thumb joystick (setting) | Drag | Pinch | HUD buttons; tap a bell or the lamp stand when near |
| Desktop | Click the ground; WASD / arrows | Drag | Scroll | HUD buttons and keys (see [07](07-ui-and-language.md#keyboard)) |

- **Walking speed** is 1.3 m/s, with no running. Tap-to-walk path-finds around obstacles and sacred zones on a 0.25 m navigation grid built from `world.ts`. A tap on a place nobody can stand walks to the nearest place they can.
- **Context actions** appear as a single button when the avatar is near a ritual spot: "Ring bell", "Light a diya", "Offer water", "Sit", "Take aarti".

## Avatar

An original, stylised devotee figure. It isn't a deity, sadhu, priest or child-monk look.

- **Look:** about 1.6 m tall, simple rounded forms. Kurta and dhoti or salwar silhouette with a wool shawl. The shawl colour is one of 8 server-assigned colours. Barefoot.
- **Neutral by default:** no caste, sect or regional markers. No tilak by default. A small neutral tilak MAY appear after aarti if the advisor approves.
- **Two body variants** in the same rig, assigned at random by the server. There's no visitor choice in v1, so nothing invites free-form identity.
- **Animations:** idle, walk, namaste, pranam (standing bow), sit (sukhasana, cross-legged, facing the sanctum), japa (seated or standing), ring bell, light diya, offer water (pour from a copper lota), take aarti, receive prasad.
- **No running, jumping, dancing or emote animations exist in the rig.**
- **Remote avatars** use LODs and instancing (budgets in [10](10-performance.md)). The visitor's own avatar uses LOD0.
- **Name labels** show only when you tap an avatar, for 3 s, in the viewer's language (for example "Deodar 214" / "देवदार 214").

## Acceptance criteria

- No input sequence lets an avatar or the camera enter the garbhagriha or stand on the Nandi axis. Server tests cover this with scripted positions.
- In `half-somasutra` mode, the somasutra channel blocks the path and a visitor can't cross it.
- The scene shows the correct time-of-day phase for the current IST time within 10 minutes of a phase change.
- Tap-to-walk reaches every ritual spot from the gate without manual steering.
- Seated avatars always face the sanctum (yaw within ±10° of the line to the linga).

## Open decisions

1. **Seasonal weather.** Snow and monsoon mist in M5, or after launch?
2. **Tilak after aarti.** Include it (needs advisor approval) or leave it out?
3. **Ganesha shrine rituals.** Only pranam (default), or also a small modak or durva offering?
