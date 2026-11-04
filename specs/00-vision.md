# 00 — Vision

## Purpose

Sannidhi is a small, quiet temple on a Himalayan hillside that anyone can visit from a phone. You arrive at the gate, leave your footwear, ring the bell and walk up a stone path through deodar trees to a Shiva shrine. Other people are there too: you see them walking, sitting, bowing and lighting lamps, but nobody talks. Twice a day everyone hears the same aarti at the same moment.

The single job of the product: **give people a few calm minutes of devotion in company, wherever they are.**

## Audience

- People in India and the diaspora who want a moment of darshan or japa during the day but can't visit a temple. Typical cases are office workers, students, the elderly, and people far from home.
- People who keep a daily japa practice and like doing it "together" with others.
- Mostly mobile (Android first). Many visitors are on mid-range or low-end phones on 4G with prepaid data.
- Bilingual: Hindi and English at launch.

## Principles

1. **Quiet togetherness.** Presence without conversation. No chat, no comments, no profiles, no follower counts.
2. **Reverence first.** The temple behaves like a temple. See [08 Cultural guidelines](08-cultural-guidelines.md).
3. **Arrive in seconds.** A visitor sees the temple quickly even on a slow network. Detail streams in later. See [10 Performance](10-performance.md).
4. **Nothing to sign up for.** No account, no login, no personal data. Identity is a server-assigned name such as "Deodar 214" that lasts one visit.
5. **Symbolic offerings.** Lamps, water and bilva leaves are gestures. Nothing can be bought.
6. **Small and honest.** Donations pay for servers and artwork. They never change what happens in the temple.

## What a visit looks like

1. The page opens on a calm loading screen, "Opening the temple doors", and shows the temple within a few seconds.
2. The visitor appears at the gate barefoot. The footwear rack shows they have left their shoes. A one-line hint explains how to move.
3. They walk up the path, optionally ringing bells along the way, pass the Ganesha shrine, and reach the courtyard with Nandi facing the sanctum.
4. They can sit on a mat in the mandapa and take darshan, turn a japa mala, walk pradakshina, light a diya at the lamp stand or offer water at the threshold.
5. At 06:00 and 19:00 IST the aarti begins for everyone at once. Afterwards visitors can take aarti and receive prasad.
6. They leave whenever they like. Nothing is saved except optional local preferences.

## Non-goals

- Chat, voice, video, or any visitor-written text.
- Accounts, friends lists, leaderboards, streaks or badges.
- Paid features, paid offerings, ads or sponsorships inside the temple.
- Live-streaming a real temple, or recreating a specific real temple.
- Astrology, horoscopes, puja booking or e-commerce.
- VR headsets in v1. The design shouldn't block them later.

## Glossary

| Term | Meaning in this project |
|---|---|
| Aarti (आरती) | Worship with a lamp waved before the deity, with song and bells. Scheduled twice daily. |
| Aarti lena | After aarti, passing the hands over the flame and then over the eyes and head |
| Antarala | Vestibule between the mandapa and the sanctum |
| Bilva / bel patra | Trifoliate leaf offered to Shiva |
| Darshan (दर्शन) | Seeing and being seen by the deity. Here it is a camera view that frames the sanctum. |
| Deepa / diya (दीया) | Oil lamp |
| Garbhagriha | Sanctum that houses the linga. Never entered by avatars. |
| Hall (कक्ष) | One shared copy of the temple. Has up to 8 instances. |
| Instance | A copy of a hall holding up to 50 visitors |
| Japa (जप) | Repetition of a mantra, counted on a mala |
| Jal (जल) | Water offered to Shiva |
| Jaladhari / somasutra | The channel that carries offered water out of the sanctum. It is not crossed during pradakshina. |
| Kund | Stepped water tank |
| Mala (माला) | String of 108 beads plus the meru bead |
| Mandapa | Pillared hall in front of the sanctum |
| Meru / sumeru | The 109th "guru" bead. The mala is turned back at it, never crossed. |
| Nandi | The bull, Shiva's vahana. Sits facing the sanctum. |
| Pradakshina / parikrama (परिक्रमा) | Walking around the shrine with it on your right |
| Prasad (प्रसाद) | Blessed food given after worship. Symbolic here. |
| Pranam (प्रणाम) | Bow with joined palms |
| Shikhara | Curved tower over the sanctum (Nagara style) |

## Originality constraints

Sannidhi is inspired by the idea behind sansatemple.com: a quiet multiplayer online temple. It is an original work:

- No code, assets, text, names, UI layout, colours or wire format from that site.
- Our own temple tradition, layout, rituals, art direction, sound and protocol.
- Shared patterns (rooms, synced worship times, one tab rendering) are generic engineering choices, written from scratch. See [reference/prior-art-sansa.md](reference/prior-art-sansa.md).

## Acceptance criteria

- A first-time visitor on a mid-range Android phone over 4G can reach the temple and light a diya without instructions beyond the on-screen hints.
- No screen asks for a name, email, phone number or login.
- A visitor can't send any free text to anyone.
- Every visible or audible element passes the [08](08-cultural-guidelines.md) review.

## Open decisions

1. **Product name.** "Sannidhi" is a working title. Before launch, check trademarks and app-store names and buy the domain.
2. **Audience expansion.** A third language after launch (Tamil, Telugu, Marathi, Bengali …) depends on visitor data.
