# 09 — Privacy, analytics and donations

## Purpose

What data Sannidhi handles (as little as possible), which aggregate events are counted, and how optional UPI donations work. The legal checklist is a list of questions to take to a lawyer or chartered accountant, not legal advice.

## Privacy principles

1. **No personal data by design.** No accounts, names, emails, phone numbers, free text, location or device IDs.
2. **No cookies and no third-party trackers.** No Google Analytics, no ad pixels, no social widgets.
3. **Counts, not people.** Analytics are aggregate event counts with no visitor identifier.
4. **Short retention.** Anything tied to a connection disappears within minutes of leaving.

## Data inventory

| Data | Where | Why | Kept for |
|---|---|---|---|
| WebSocket connection, server-assigned visitor id and name | RoomDO memory + socket attachment | Presence | While connected |
| Resume record (visitor id, name, mat, queue places) | RoomDO storage | Reconnect without losing your place | `RESUME_WINDOW_MS` (60 s) |
| Hashed IP (daily salt) for the per-instance connection cap | RoomDO memory only | Abuse protection | While connected; never stored or logged |
| Lit lamps (slot, times) | RoomDO storage | Lamps keep burning after you leave | Until expiry (10 min) |
| Today counters (aggregates) | DirectoryDO storage | Communal "today" board | 7 days |
| Aggregate event counts | Workers Analytics Engine | Product decisions | Cloudflare's dataset retention |
| Page views (cookie-free) | Cloudflare Web Analytics | Traffic | Cloudflare's retention |
| IP addresses in platform logs | Cloudflare (as our processor) | Running the network | Cloudflare's terms; our own logs exclude IPs |

### Browser storage keys

All keys are prefixed `sannidhi:`. All storage access is wrapped in try/catch, and the app works if storage is unavailable.

| Key | Storage | Contents |
|---|---|---|
| `lang-v1` | local | `"hi"` or `"en"` |
| `settings-v1` | local | Lite mode, picture quality (automatic or a chosen tier), reduced motion, whether the Lite suggestion was shown; later joystick and lyrics |
| `audio-v1` | local | Master on/off, channel volumes |
| `onboarding-v1` | local | Which hints were completed |
| `japa-v1` | local | Current bead, malas today (local count) |
| `view-v1` | session | Camera, the visitor's position, facing and mat, hall, instance and mala bead, for restore within 30 min |
| `resume-v1` | session | Resume token |
| `render-owner-v1` | local | Which tab renders (tab coordination) |

## Product analytics

**Counted on the server** (the server already sees the action, so no extra client traffic):

`visit_start` (welcome without resume) · `namaste` · `pranam` · `bell` · `diya_lit` · `jal` · `bilva` · `mala` · `parikrama` · `sit` · `aarti_attend` (connected for ≥ 60 s during an aarti) · `take_aarti` · `prasad` · `hall_full` · `close_<code>`

**Sent by a client beacon** (`POST /api/beacon`, only for things the server can't see):

`boot_error` · `unsupported_device` · `lite_mode_on` · `language_switch` · `support_open` · `support_upi_open` · `support_copy_upi`

**Dimensions allowed:** `event`, `hall`, `lang`, `lite` (boolean), `tier` (`low`/`mid`/`high`).

**Never sent:**
- visitor id, resume token, IP, user agent, screen size;
- precise timestamps (the server buckets to the minute);
- referrer query strings.

Cloudflare Web Analytics is loaded only on the production domain over HTTPS.

## Legal notes (privacy)

- India's Digital Personal Data Protection Act, 2023 applies to processing digital personal data. Sannidhi is designed to collect none. **Before adding anything that could identify a person** (accounts, emails, contact forms, crash reports with device data), get legal advice and update this spec first.
- Publish a short bilingual privacy page saying exactly what the inventory above says, in plain words.
- No age gate is needed while no personal data is collected. Revisit if that changes.

## Donations (optional UPI)

### What visitors see

The "Support the temple's upkeep" sheet, reached only from Settings and the Exit screen (spec 07), shows:
1. The title and note (`support.title`, `support.note` in spec 07).
2. A UPI QR code, generated at build time from the configured UPI ID and payee name, as a static SVG.
3. On mobile only, an "Open UPI app" button linking to `upi://pay?pa=<VPA>&pn=<PAYEE>&cu=INR&tn=Sannidhi%20upkeep`. No amount is preset (see Open decisions).
4. The UPI ID as selectable text with "Copy UPI ID".
5. A link to "Where support goes": a short, plain monthly cost breakdown (servers, artwork, recordings), updated by hand.

### Configuration

- Build-time env vars `VITE_UPI_VPA` and `VITE_UPI_PAYEE`.
- If either is missing, the support sheet and its entry points don't render (the feature is off).
- The payee name MUST match the receiving bank account's name. Don't present the fictional temple name as a registered religious institution.

### Never

- Tie donations to blessings, merit, prayers or anything inside the temple (spec 08).
- Show donor names, amounts, totals, leaderboards or "X people donated today".
- Use pop-ups, timers, guilt wording, or prompts during aarti or near the sanctum.
- Accept card payments or store any payment data. The UPI app handles everything.

### Legal checklist (take to a lawyer or CA before switching donations on)

1. **Who receives the money?** An individual, a public charitable trust, a society, or a Section 8 company. Each has different tax and compliance duties.
2. **Tax receipts:** only say donations are tax-deductible if the receiving entity holds a valid 80G registration. Otherwise state that they aren't.
3. **Foreign contributions:** the Foreign Contribution (Regulation) Act, 2010 (FCRA) restricts receiving foreign contributions without registration or permission. Ask how payments from NRIs and from abroad are treated. Until that is clear, aim the UPI option at visitors in India and don't solicit donations from abroad.
4. **Income and records:** how donations are taxed for the recipient, and what records to keep (receipts, expenses).
5. **Wording:** confirm the sheet's wording is not misleading under consumer-protection rules.
6. **Sign-off:** record the advice and the date in this spec before setting `VITE_UPI_VPA` in production.

## Acceptance criteria

- No request from the client to any third-party domain except the Cloudflare Web Analytics beacon (Playwright network check).
- The beacon rejects unknown event names and any extra fields.
- No stored record or log line contains an IP address or user agent (spec 05 test).
- With `VITE_UPI_VPA` unset, no support UI renders anywhere.
- The UPI deep link and QR encode the same VPA and payee.

## Open decisions

1. **Recipient entity** for donations (see the legal checklist), and when donations are switched on. **On hold (2026-11-04):** no donations for now, decided by the owner. `VITE_UPI_VPA` stays unset everywhere.
2. **Preset amounts.** Offer chips such as ₹51 / ₹101 / ₹251, or leave the amount to the visitor (default: none)?
3. **Yearly transparency note:** publish one?
