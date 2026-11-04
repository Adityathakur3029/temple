# Prior art: sansatemple.com

## Purpose

Sannidhi was inspired by **산사 (Sansa, sansatemple.com)**, a Korean online Buddhist temple where strangers sit together silently as child-monk avatars. On 2026-11-03 we read its public client code to understand the patterns behind a quiet multiplayer temple. The full teardown is a private artifact: https://claude.ai/artifact/L7pAWWqykTERkeRVcYwfhi

This note records which **general patterns** we adopt, what we deliberately do differently, and what we must never copy.

## Patterns we adopt (re-implemented from scratch)

| Pattern | Our version |
|---|---|
| Static web app + edge workers for realtime | Cloudflare Pages + Worker + Durable Objects (spec 01, 05) |
| Rooms that split into parallel copies when full | 20 halls × 8 instances × 50 (spec 04) |
| Room list endpoint before connecting | `GET /api/rooms` (spec 04) |
| Server-authoritative positions, seats and queues | RoomDO rules (spec 05) |
| Server-assigned names, no visitor text | Curated Himalayan nature names (spec 05) |
| Reconnect with a resume token | 60 s resume window (spec 04) |
| Shared worship at fixed local times, synced by server clock | Aarti at 06:00 / 19:00 IST (spec 06) |
| Only one browser tab renders | BroadcastChannel ownership (spec 10) |
| Idle sleep to save battery and server cost | Rest and calm modes (spec 10) |
| Versioned, immutable asset URLs with a hashed manifest | Manifest + `/v/<release>/` (spec 11) |
| Minimal analytics with a short event allow-list | Server-counted events, no GA (spec 09) |

## What we do differently

- **Tradition:** a Himalayan Shiva temple with Hindu rituals (bells, japa with the meru rule, pradakshina, diya, jal, aarti, prasad), not a Korean Buddhist temple.
- **Avatar:** an original barefoot devotee figure, not a child monk.
- **Analytics:** no Google Analytics. Events are counted server-side, plus a tiny beacon (spec 09).
- **Donations:** UPI only, with a legal checklist and strict placement rules (spec 09).
- **Protocol:** our own JSON v1 messages and compact tuples. Any future binary format is our own design (spec 04).
- **Capacity:** 50 per instance, chosen for low-end Android phones (spec 10).
- **Language:** Hindi and English.
- **No disabled features** are shipped in the code. Unused features are removed, not hidden behind a function that always returns false.

## Never copy

- Any code, minified or not, from sansatemple.com bundles.
- Any asset: models, textures, images, audio, fonts, icons.
- Any text or UI copy, in any language, including translations of its Korean strings.
- Its names: "Sansa", "maru" room ids, "SNS3" or any other identifier from its wire format.
- Its visual identity: palette, layout, liquid-glass UI styling, boot screen design.
- Its donation details or third-party account identifiers.

If an implementation detail seems to need something from that site, find a public standard, a library's documentation or a first-principles design instead, and note the source in the code comment or spec.
