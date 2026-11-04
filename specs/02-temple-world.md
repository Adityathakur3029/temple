# 02 — Temple world

## Purpose

The physical temple: layout, sacred zones, light, camera, controls and the visitor's avatar. Coordinates are in metres. `+x` is north, `+z` is east, and `+y` is up. The shrine faces east, and the linga sits at the origin.

## Setting

A fictional small stone temple on a forested Himalayan ridge at about 2,000 m. Deodar cedars, mossy rocks and a spring-fed kund surround it, with snow peaks far behind. The style is North Indian Nagara: a square garbhagriha under a curved stone shikhara topped by an amalaka and kalasha, a short antarala, and an open pillared mandapa. The palette is weathered grey-brown stone, deodar green, saffron and marigold accents, and brass. The temple must not resemble any specific real temple closely enough to be mistaken for it (see [08](08-cultural-guidelines.md)).

## Layout

| Element | Position (x, z) | Size / notes |
|---|---|---|
| Garbhagriha (sanctum) with Shiva linga on a yoni pitha | (0, 0) | Inner 5 × 5 m, door facing +z. **Not walkable.** |
| Shikhara | over (0, 0) | ~16 m tall; the landmark visible from the gate |
| Jaladhari / somasutra outlet | north wall (2.6, 0) → channel to (10.5, 0) | Visible stone spout and channel on the north side |
| Antarala and threshold | z 2.6 … 5 | The jal-offering spot is at the threshold, beside the door (see 03) |
| Mandapa (open hall) | x −7 … 7, z 5 … 19 | 12 pillars, raised plinth, two blocks of mats either side of a clear central aisle |
| Nandi on a platform, facing −z | (0, 22) | The **Nandi axis** x −1.2 … 1.2, z 0 … 22 is a no-stand, no-walk zone |
| Mandapa bells | (±2.2, 19.5) | Hung from the mandapa entrance beam |
| Courtyard | x −12 … 12, z 19 … 30 | Stone-paved |
| Deepa stand (108-lamp tiered stand) | (−8.5, 25) | Up to 4 visitors at a time stand at marked spots around it |
| Aarti plate stand (after aarti) | (2.2, 20.5) | Where visitors "take aarti" after the service |
| Pradakshina path | loop at x ±10.5, z −8 … 24 | Stone path around the shrine and mandapa; see [Pradakshina](#pradakshina-path) |
| Kund | centre (16, 32), 8 × 8 m | Stepped tank, not swimmable; the steps are walkable down to the second step |
| Path from the gate | z 30 … 58, winding | Lined with 8 hanging bells (`path-1` … `path-8`) and deodars |
| Ganesha shrine (small, open-fronted) | (−5, 52), facing +x | Small murti; visitors may bow here (pranam is the only action) |
| Gate (torana) with gate bell | (0, 58) | Spawn area just inside the gate |
| Footwear rack | (−3, 61), outside the gate | Shows a pair of chappals for each visitor present (decorative) |
| Temple-wide "today" board | (3, 56) | Painted wooden board: diyas lit, malas completed, parikramas today |

These positions are the defaults for the greybox (M1). Final art MAY adjust them by up to 2 m without a spec change. Larger moves update this table and `packages/protocol/src/world.ts`.

## Sacred and blocked zones

These are defined in `packages/protocol/src/world.ts` and enforced by both client (collision) and server (position correction):

1. **Garbhagriha interior:** never enterable. The camera can't pass through the door either.
2. **Nandi axis:** the strip between Nandi and the sanctum door. Avatars walk around it, never across it, so the route to the threshold goes along the sides of the mandapa.
3. **Kund water:** the water and below the second step.
4. **Somasutra channel:** in half-pradakshina mode the channel is a blocking line on the path (see below).
5. **Outside the boundary:** the forest edge is a soft wall about 3 m beyond the path.

## Pradakshina path

- A visitor walks the loop **clockwise, keeping the shrine on their right**: from the east side (in front of Nandi) to the south, then west, then north.
- **Mode `half-somasutra` (default):** the visitor walks clockwise up to the somasutra channel on the north side, does not cross it, and returns the same way to the east side. This follows the common North Indian practice for Shiva temples of not crossing the jaladhari. It is marked **check with advisor** in [08](08-cultural-guidelines.md).
- **Mode `full`:** a full clockwise loop, with the channel covered by a small bridge slab. This exists in case the advisor prefers it.
- **Checkpoints** for counting (server-side, see 03): `E` (0, 24), `S` (−10.5, 8), `W` (0, −8), `N` (10.5, 4) just before the channel.

## Light and time

- **Time of day follows IST.**

  | Phase | IST | Look |
  |---|---|---|
  | Night | 18:30–05:30 | Moon, lamp light, stars |
  | Dawn | 05:30–06:30 | Pink-gold sky |
  | Day | 06:30–17:30 | Sun over the ridge |
  | Dusk | 17:30–18:30 | Warm sky, lamps being lit |

  Transitions blend over 10 minutes. Seasonal sunrise/sunset tables are a later option.
- **Lamps:** the deepa stand, sanctum lamps and lanterns use emissive materials and glow sprites. At most **4 real-time point lights** are active (sanctum, deepa stand, mandapa, gate). Lit diyas don't each get a light.
- **Shadows:** a single directional light with a small shadow map on High tier only. Baked ambient occlusion in textures on all tiers.
- **Weather:** clear by default. Seasonal snow (Dec–Feb) and monsoon mist (Jul–Sep) are a stretch goal (see Open decisions).

## Camera

- **Default:** third-person orbit behind the avatar. Distance 2.5–12 m (pinch or scroll), pitch −10° to +35°, eased follow.
- **Darshan view:** one tap frames the linga through the sanctum door from the mandapa. It is the default when seated on a mat, and the visitor can still look around a little (±25° yaw).
- **Constraints:** the camera never enters the garbhagriha or clips through Nandi or pillars. It pulls in towards the avatar when blocked.
- **Reduced motion:** with `prefers-reduced-motion`, camera transitions cut instead of fly.

## Controls

| Platform | Move | Look | Zoom | Act |
|---|---|---|---|---|
| Touch | Tap the ground to walk there; or a left-thumb joystick (setting) | Drag | Pinch | HUD buttons; tap a bell or the lamp stand when near |
| Desktop | Click the ground; WASD / arrows | Drag | Scroll | HUD buttons and keys (see [07](07-ui-and-language.md#keyboard)) |

- **Walking speed** is 1.3 m/s, with no running. Tap-to-walk path-finds on the walkable navmesh around sacred zones.
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
