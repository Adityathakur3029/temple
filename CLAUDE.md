# Sannidhi — an online Himalayan Shiva temple

Sannidhi (सन्निधि, "sacred presence") is a browser-based 3D temple where strangers sit, walk and pray together in quiet. There is no chat and there are no accounts. Visitors see each other as simple devotee figures and can greet with namaste, bow, ring bells, count japa on a mala, walk pradakshina, light a diya, offer water, sit on mats in the mandapa and join the twice-daily aarti.

"Sannidhi" is a working title. See [specs/README.md](specs/README.md) for open decisions.

## Golden rules

1. **The specs are the source of truth.** Read the relevant spec in `specs/` before writing code. If code and spec disagree, stop and ask, or fix the spec in the same change with the user's agreement.
2. **Change the spec with the behaviour.** Any change to behaviour, limits, messages, strings or budgets updates its spec in the same commit.
3. **Protocol changes go through one place.** Message shapes, limits and constants live in `packages/protocol` and are documented in [specs/04-realtime-protocol.md](specs/04-realtime-protocol.md). A breaking change bumps `PROTOCOL_VERSION`. Ask the `protocol-reviewer` agent to check it.
4. **Respect comes before features.** Anything visible or audible (scene layout, animations, text, sound, donation wording) must follow [specs/08-cultural-guidelines.md](specs/08-cultural-guidelines.md). Ask the `cultural-reviewer` agent to check it.
5. **Stay inside the budgets.** Mobile performance and data budgets in [specs/10-performance.md](specs/10-performance.md) are hard limits. Ask the `perf-auditor` agent before merging asset or rendering changes.
6. **Everything is original.** This project was inspired by sansatemple.com. Never copy its code, assets, text, names, UI layout or wire format. See [specs/reference/prior-art-sansa.md](specs/reference/prior-art-sansa.md).
7. **No real temple.** The temple is fictional. Don't reproduce a specific real temple's architecture, name or iconography.

## Must-follow cultural rules (summary of spec 08)

- Footwear is left at the gate. Avatars are barefoot inside the temple.
- The garbhagriha (sanctum) is visible but no avatar may enter it.
- Keep the line between Nandi and the sanctum clear. No standing, sitting or walking on that axis.
- Seated avatars face the sanctum. No pose points feet towards the deity.
- No dancing, jokes, emotes or playful animations anywhere in the temple.
- Offerings are symbolic. Money never buys a blessing, a bigger lamp or any in-temple effect.
- No free-text input from visitors anywhere: no chat, no custom names, no messages.

## Stack and layout (planned; created in milestone M0)

```
apps/web/            Vite + TypeScript + Three.js client (static, Cloudflare Pages)
apps/realtime/       Cloudflare Worker + Durable Objects (rooms, presence, rituals)
packages/protocol/   Shared message types, validators, constants (no runtime deps)
assets-src/          Source models/audio (not shipped); see spec 11
tools/               Asset pipeline, load-test bots, link checker (Node scripts)
specs/               Product and technical specs (source of truth)
```

- TypeScript `strict` everywhere. No `any` in `packages/protocol`.
- npm workspaces, Node 22+ (see `.nvmrc`). Node 20 is end of life, and wrangler 4 needs 22.
- Scripts must be cross-platform Node or npm scripts. The main developer works on **Windows**, so don't use bash-only syntax, `rm -rf` or `&&` chains that assume POSIX in `package.json`.
- Pin exact dependency versions (no `^`) for `three` and `wrangler`.

Planned npm scripts (root):

| Script | Does |
|---|---|
| `npm run dev` | Web dev server + `wrangler dev` for realtime |
| `npm run build` | Build all workspaces |
| `npm test` | Vitest across workspaces |
| `npm run test:e2e` | Playwright (desktop + mobile emulation) |
| `npm run check` | `tsc --noEmit`, ESLint, size budgets, spec link check |
| `npm run bots -- --hall hall-01 --n 200` | Load-test bots against a local or staging server |
| `npm run deploy:*` | Deploy steps (always asks first; see the `release` skill) |

## Key numbers (defined in spec 04; mirror in `packages/protocol/src/constants.ts`)

- 20 halls (`hall-01` … `hall-20`). Each hall has up to 8 instances of 50 visitors.
- The server sends deltas at up to 10 Hz. Positions are rounded to 1 cm.
- Aarti happens at 06:00 and 19:00 IST. Day/night follows IST.
- A diya burns for 10 minutes, one per visitor at a time. The lamp stand holds 108 diyas per instance.
- Idle sleep starts after 3 minutes of no input. The view checkpoint lasts 30 minutes. The resume window is 60 seconds.

## Spec reading order

[00 vision](specs/00-vision.md) → [01 architecture](specs/01-architecture.md) → [02 world](specs/02-temple-world.md) → [03 rituals](specs/03-rituals.md) → [04 protocol](specs/04-realtime-protocol.md) → [05 server](specs/05-server.md) → [06 sound](specs/06-sound-and-aarti.md) → [07 UI and language](specs/07-ui-and-language.md) → [08 cultural guidelines](specs/08-cultural-guidelines.md) → [09 privacy, analytics, donations](specs/09-privacy-analytics-donations.md) → [10 performance](specs/10-performance.md) → [11 assets](specs/11-assets-and-licensing.md) → [12 testing](specs/12-testing-and-acceptance.md) → [13 roadmap](specs/13-roadmap.md)

Work milestone by milestone from [specs/13-roadmap.md](specs/13-roadmap.md). Don't start a milestone until the previous one meets its exit criteria.

## Project tooling in `.claude/`

- **Agents** (read-only reviewers): `cultural-reviewer`, `protocol-reviewer`, `perf-auditor`.
- **Skills:**
  - `add-ritual`: the checklist for a new devotional action.
  - `add-asset`: adding a model, texture or sound with licence and manifest.
  - `release`: the deploy sequence, run only when the user asks.
- **Permissions** (`.claude/settings.json`):
  - Dev, test and read-only git commands are allowed.
  - Deploys, secret changes and `git push` always ask first.
  - `.env` and `.dev.vars` files can't be read.
