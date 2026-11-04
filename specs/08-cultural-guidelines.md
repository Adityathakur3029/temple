# 08 — Cultural guidelines

## Purpose

Sannidhi depicts a living religious practice. These rules keep the temple respectful, accurate and welcoming. They apply to everything a visitor can see or hear, to marketing material, and to the code paths that enforce behaviour. The `cultural-reviewer` agent checks changes against this document. A human advisor signs off at the milestones below.

Where Hindu practice varies by region or tradition, this document picks a default and marks it **check with advisor**. Those defaults are configurable, so the advisor's answer can be applied without redesign.

## Review and sign-off

- **Advisor:** a person knowledgeable in Shaiva temple practice (for example a temple priest or a scholar), plus a second reviewer from a different region of India.
- **Sign-off points:**
  1. **M1:** greybox layout and sacred zones.
  2. **M3:** ritual flows and animations.
  3. **M5:** final art, audio, all text in both languages, credits.
  4. **Before launch:** the whole product, plus marketing images.
- **Recording:** each sign-off and every open item is recorded in this file's [sign-off log](#sign-off-log).

## Sacred space

1. **Garbhagriha:** visible from the mandapa and the threshold, never entered by avatars or the camera.
2. **Nandi axis:** the line from Nandi to the sanctum door is kept clear. Paths and spots route around it.
3. **Footwear:** visitors leave footwear at the gate, and avatars are barefoot inside the boundary. The footwear rack is outside the gate.
4. **Direction:** pradakshina is clockwise, keeping the shrine on the right. For this Shiva temple the default is the half round that turns back at the somasutra (jaladhari) without crossing it. **Check with advisor.**
5. **Posture:**
   - No pose points the soles of the feet towards the sanctum or the Ganesha murti.
   - Seated avatars sit cross-legged facing the sanctum.
6. **Decorum:**
   - No running, jumping, dancing, emotes, comic effects or celebratory particles anywhere in the temple.
   - Walking speed is calm.
7. **Sound:** bells are rate-capped so the temple never becomes noisy. No music outside aarti except the optional personal mantra loop.
8. **Night hours:** see open decision 3. The default keeps the temple open with no changes.

## Depiction

- **Shiva linga:**
  - An aniconic linga on a yoni pitha with its jaladhari spout, in dark stone.
  - Simple, dignified forms, adorned with a few bilva leaves and flowers. An optional copper dharapatra (dripping water pot) may hang above it.
  - The tripundra (three ash lines) on the linga is **check with advisor**.
- **Nandi:** seated and calm, facing the sanctum, with a traditional form and no exaggerated or cartoon proportions. Never animated.
- **Ganesha:** a small traditional seated murti in an open shrine near the gate. Never animated, never stylised as a mascot.
- **Human-made:** all three (linga, Nandi, Ganesha) are human-made, never AI-generated, and reviewed by the advisor before shipping. See spec 11.
- **Deity images stay in the shrine:** no deity images or faces in UI icons, buttons, loading screens, the favicon or app icon, notifications, donation prompts or merchandise-style decoration. The app icon is the shikhara silhouette or a diya.
- **Sacred symbols** (ॐ, trishul, damru) appear only at height or in sacred places: the sanctum lintel, banners, the aarti lamp. **Never** on floors, steps, mats, the footwear rack, or anything sat or stepped on.
- **The swastika motif** is not used as decoration in v1. Many international visitors misread it. This is a product choice for clarity, not a judgement on a sacred Hindu symbol.
- **The temple is fictional.** Don't reproduce any specific real temple's architecture, name, idol or signage closely enough to be mistaken for it.

## Rituals and offerings

- **Symbolic only:** offerings (diya, jal, bilva, prasad) are symbolic gestures with no reward, score or rank.
- **No claims:** never claim that an action brings merit (punya), fulfils wishes, heals, or brings luck. Wording stays descriptive ("Light a diya"), never promissory.
- **Japa** follows the meru rule: turn back, never cross. The count is 108.
- **Aarti text** (if shown) and any mantra text are verified by the advisor in Devanagari and romanisation.
- **Prasad** is free for everyone and symbolic. Default item: mishri (crystal sugar) with elaichi dana. **Check with advisor.**

## Money

- Donations never change anything inside the temple: no bigger lamps, no special mats, no names displayed, no priority in queues.
- Donation prompts never appear near the sanctum, during aarti, in loading screens or as pop-ups. Entry points are only Settings and the Exit screen (spec 07).
- Wording describes costs ("servers, artwork, recordings"). Never connect money with blessings, merit or prayers being answered.

## Inclusion

- **Everyone is welcome.** The temple never asks about, restricts or labels anyone by religion, caste, gender, region or personal condition.
- **No caste markers:** no community surnames, symbols or regional identity markers on avatars or in names. The name list follows spec 05.
- **No sectarian content:** no claims that one tradition, deity or region is superior, and no political or communal content.
- **Bilingual:** Hindi and English are equal. Neither is shown as the "real" one.

## Calendar and festivals

- Festival decorations and special events (Maha Shivaratri, Shravan Mondays, Kartik Purnima …) use dates entered by hand each year from a published panchang into `config/festivals.json`, and are reviewed by the advisor.
- **Never** compute or guess festival dates in code, and never ship invented dates.

## Marketing and screenshots

- Images of the linga and murtis are framed respectfully: no memes, no jokes, no product-style beauty shots with sale language.
- Captions follow the tone rules in spec 07.

## Check-with-advisor list

| Item | Default | Spec |
|---|---|---|
| Half pradakshina turning back at the somasutra | On | 02, 03 |
| Aarti times 06:00 and 19:00 IST | On | 03, 04 |
| Aarti performer: pujari figure vs lamp-only | Lamp-only until decided | 03 |
| Water offering at the threshold (not on the linga) | On | 03 |
| Tripundra on the linga | Off | this spec |
| Tilak on avatars after aarti | Off | 02 |
| Prasad item | Mishri + elaichi dana | this spec |
| Night hours (doors, bells) | No change | this spec |
| Dandavat pranam variant | Not in v1 | 03 |
| Aarti lyrics text | Hidden until verified | 06 |
| Temple mark (boot screen, favicon, future app icon): kalasha, amalaka, tower proportions, doorway | Stylised M0 mark in `apps/web/src/ui/shikhara.svg`; no sacred symbols on it | this spec, 11 |

## Acceptance criteria

- Automated tests prove that no avatar position inside the garbhagriha or on the Nandi axis is accepted by the server (spec 05).
- A grep check in CI fails if deity image assets are referenced from UI icon, favicon, loading or donation code paths (asset tags in the manifest, spec 11).
- Every check-with-advisor item has a recorded decision before launch.
- The advisor sign-off log has entries for M1, M3, M5 and launch.

## Sign-off log

| Date | Milestone | Advisor | Result / notes |
|---|---|---|---|
| — | — | — | — |

## Open decisions

1. **Who the advisor is** (and the second reviewer).
2. **Festival events** in v1, or after launch.
3. **Night hours.** Should the sanctum doors be shown closed and the bells muted between the night and morning service (traditional), or should the temple stay open around the clock for visitors in other time zones?
