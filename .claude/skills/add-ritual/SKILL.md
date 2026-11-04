---
name: add-ritual
description: Checklist for adding or changing a devotional action in Sannidhi (for example a new offering, gesture, or scheduled event). Use whenever a task adds a visitor action that other people can see or hear, or changes how an existing ritual works. Walks through spec, protocol, server, client, strings, sound, analytics, tests and cultural review in order.
---

# Add or change a ritual

A ritual touches every layer. Do the steps in order and don't skip the spec step. A ritual that exists only in code will drift.

## 1. Spec first
- Add or update the ritual's block in `specs/03-rituals.md` using the same headings as the existing blocks:
  - purpose
  - where it happens
  - input
  - UI
  - network
  - server rule
  - animation
  - sound
  - accessibility
  - acceptance criteria
- Check the ritual against `specs/08-cultural-guidelines.md`. If it depends on a tradition that varies by region or sampradaya, add it to that spec's "Check with advisor" list and make the behaviour configurable.
- Show the user the spec change and get agreement before writing code.

## 2. Protocol (`packages/protocol`)
- Add message types and their type guards. Add constants, such as a cooldown, a duration or a queue size, to `constants.ts`.
- Add a row to the message table and the rate-limit table in `specs/04-realtime-protocol.md`.
- Decide whether the change is breaking. If it is, bump `PROTOCOL_VERSION`.
- Write unit tests for valid and invalid payloads.

## 3. Server (`apps/realtime`)
- Handle the message in the RoomDO. Validate it, apply the rate limit, enforce the server rule (position near the ritual spot, cooldown, queue order) and broadcast only the fields spec 04 lists.
- Keep any state that must survive hibernation in WebSocket attachments or DO storage.
- If the ritual feeds a temple-wide counter, update the counter path in `specs/05-server.md`.
- Add a Durable Object test covering the success path, the rate limit and the rejection paths.

## 4. Client (`apps/web`)
- **UI:** the button or interaction follows `specs/07-ui-and-language.md`, with keyboard and touch input and an accessible label.
- **Animation:** follows the posture rules (facing, feet, no playful motion). Remote avatars play the same animation from the broadcast event.
- **Sound:** the effect goes on the correct channel in `specs/06-sound-and-aarti.md`, with spatial audio for remote visitors and a voice cap.
- **Strings:** add every new string in **both** English and Hindi to the string table in spec 07 and to the locale files. Mark the Hindi for native-speaker review.

## 5. Analytics
- If the ritual should be counted, add a single event name to the list in `specs/09-privacy-analytics-donations.md`. Count it on the server when the server already sees the action. Never attach identifiers.

## 6. Assets
- New models or sounds go through the `add-asset` skill (licence, optimisation, manifest, credits).

## 7. Verify
- `npm run check` and `npm test` pass.
- Add or extend a Playwright scenario for the ritual. Use two browser contexts when other visitors should see it.
- Ask the `protocol-reviewer` agent to review the protocol and server changes, and the `cultural-reviewer` agent to review the strings, animation, sound and placement. Fix their blockers before calling the ritual done.
