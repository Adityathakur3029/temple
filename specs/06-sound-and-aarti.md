# 06 — Sound and aarti

## Purpose

What visitors hear, how sound is mixed, how the aarti plays in sync for everyone, and where recordings come from.

## Principles

- **Quiet by default.** Sound stays off until the visitor turns it on (browsers require a tap anyway). Outside aarti, a quiet background loop plays (one by day, one at night), and a visitor may play meditation for themselves (owner, 2026-11-23).
- **Never essential.** Every sound has a visual counterpart (spec 07).
- **Authentic and licensed.** Recordings are made for us or properly licensed (see [Licensing](#licensing)).

## Channels

| Channel | Contains | Default volume |
|---|---|---|
| Ambience | The day and night background loops; later wind in deodars, the kund's spring, birds (day), crickets and owl (night) | 60 |
| Effects | Bells, match strike, water pour, running tap water (washing hands, spec 03), bead clicks, footsteps on stone (optional), conch at aarti start | 70 |
| Chant | The aarti recording; meditation; the optional personal "Om Namah Shivaya" loop | 80 |

- A **master switch** plus per-channel volume (0–100), stored in `localStorage` key `sannidhi:audio-v1`.
- Built with the Web Audio API: one `AudioContext`, a gain node per channel, then the master gain.
- **Unlock:** the context is created or resumed on the first user gesture. The HUD shows "Turn sound on" until then, and the aarti banner repeats the prompt.
- **Switch:** the bell button in the top bar, or key `M`. It reads "Turn sound on" in words until sound plays, then shows only the bell, labelled "Turn sound off" for screen readers. If sound was on last time, it starts again at the visitor's first tap or key press.

## Background and meditation

Decided by the owner on 2026-11-23. Values live in `apps/web/src/assets/sounds.ts` and `apps/web/src/audio/beds.ts`.

- **One bed at a time.** Under everything else, one loop (the *bed*) plays for each visitor, on their device only. Which one follows a fixed order:
  1. **Meditation**, while this visitor has it on.
  2. **Aarti**, while an aarti is on (§ Synced aarti), for everyone.
  3. **Background**: `background-day` by day, `background-night` at night. Night is the IST night phase, 18:30–05:30 (spec 02 § Light and time); `?ist=` previews it.
- **Meditation:**
  - The **Meditate** button in the action dock (spec 07) turns it on and off for this visitor only. Nobody else hears it or sees that it is on. Nothing is sent to the server.
  - Each time it is turned on, one meditation file is picked at random (never the same one twice in a row when there is a choice) and looped until the visitor turns it off.
  - Turning it off goes back to whatever is due now: the aarti if one is on, otherwise the background.
  - Pressing Meditate while sound is off turns sound on. Turning sound off ends meditation.
  - Meditation files are downloaded only when a visitor asks for one, and only the one in use is kept in memory.
- **During the aarti:** the aarti replaces the background for everyone. A visitor who turns meditation on during the aarti stops hearing the aarti; turning it off joins the aarti again at its current point. The aarti player is still to come (§ Synced aarti); until then the background plays at aarti time.
- **Changes** cross-fade over 1.5 s. Loops are decoded once into an `AudioBuffer` and looped without a gap.
- **The master switch** silences everything, beds and bells alike. A hidden tab plays no bed (§ Background).
- **Bells** are effects: they overlap each other and the bed, up to the voice cap below.

## Spatial effects

- Remote visitors' bells, water and matches use `PannerNode` with the `equalpower` model (cheaper than HRTF on low-end phones), `inverse` distance model, `refDistance` 2 m and `maxDistance` 40 m.
- Your own actions play non-spatial at full channel volume. Remote actions are 6 dB quieter at equal distance.
- **Voice caps:** at most 4 bell voices and 6 other effect voices at once. New sounds beyond the cap steal the oldest.
- Short effects are decoded once into `AudioBuffer`s, fetched only once sound is first turned on. The listener is the camera.
- **How effects are made:** see spec 11 § Sounds.

## Synced aarti

- **Schedule:**
  - `AARTI_TIMES_IST` (06:00 morning, 19:00 evening) from `packages/protocol/src/schedule.ts`.
  - Labels: "Morning aarti" / "प्रातः आरती" and "Evening aarti" / "संध्या आरती".
  - The aarti lasts as long as its recording, expected to be 5–8 minutes.
- **Playback:**
  - Use an `HTMLAudioElement` routed through a `MediaElementAudioSourceNode` into the chant channel. A long track is never decoded fully into memory (5 minutes of decoded stereo is over 100 MB).
  - Start at `offset = (serverNow() − startsAt) / 1000` seconds. A visitor arriving late joins at the current point.
  - Preload the file from the 15-minute banner onwards (`preload="auto"`), only if sound is on or the visitor tapped "Listen".
- **Drift correction:**
  - Every 10 s, compare `audio.currentTime` with the expected position.
  - Drift of 0.3–2 s: nudge `playbackRate` to 0.98 or 1.02 until within 0.1 s.
  - Drift over 2 s: seek.
- **Skipping:** "Mute this aarti" silences it for this occurrence only. It resumes as normal for the next one.
- **Background:**
  - When the tab is hidden, ambience and effects stop.
  - The aarti keeps playing where the browser allows, so people can listen with the screen off.
  - Media Session metadata (title "Evening aarti — Sannidhi", artwork) gives lock-screen controls.
- **Visual sync:** the sanctum lamp brightening, the lamp-circling choreography and the bells follow cue times in a small JSON file shipped with the recording (`aarti-evening.cues.json`: `[{"t": 3.2, "cue": "conch"}, …]`).
- **Optional lyrics:**
  - The traditional Shiva aarti text, in Devanagari with romanisation, follows the cue file.
  - Off by default; a toggle in settings.
  - The text must be verified by the advisor.

## Aarti content

- **Start:** three conch (shankh) blows.
- **Middle:** the aarti sung by a small group with harmonium, ghanta (hand bell), and damru or dhol accents, in a traditional style.
- **End:** "Har Har Mahadev", then silence and bells fading.
- **Recordings:** one morning and one evening recording (they may share the song with different openings). Same loudness target.

## Personal japa audio (optional)

- A seamless loop of "ॐ नमः शिवाय" chanted at a calm tempo, about 10–15 s long.
- Plays only on the visitor's device, only while the mala view is open and the visitor has switched it on. Never broadcast.

## Loudness and formats

| Type | Target | Format |
|---|---|---|
| Aarti, mantra loop | −18 LUFS integrated, true peak ≤ −1 dBTP | AAC-LC `.m4a`, 96 kbps stereo, 44.1 kHz |
| Effects | Peak ≤ −6 dBFS | AAC-LC `.m4a`, 64 kbps mono |
| Ambience loops | About −28 LUFS, seamless loop points | AAC-LC `.m4a`, 64 kbps stereo |
| Background loops | −20 LUFS integrated, peak ≤ −1 dBFS, no fade | AAC-LC `.m4a`, 64 kbps stereo, 44.1 kHz |
| Meditation loops | −18 LUFS integrated, peak ≤ −1 dBFS, no fade | AAC-LC `.m4a`, 96 kbps stereo, 44.1 kHz |

Lite mode loads ambience as one mixed loop instead of layered stems.

## Licensing

- **Preferred:** commission musicians, with a written licence covering a perpetual, worldwide right to use the recordings on the website and in promotion, including when the site accepts donations.
- **Acceptable:** CC0 or CC-BY 4.0 recordings, with credit, approved for authenticity by the advisor.
- **Not acceptable:**
  - film songs, devotional music labels' catalogue or YouTube rips;
  - CC-BY-NC (donations make "non-commercial" uncertain);
  - anything without a traceable licence.
- **The text:** the traditional aarti words are generally considered traditional. The **recording** is always separately licensed. Note the source of the text in `assets-src/LICENSES.md`.
- Every audio file has a manifest entry with its licence and credit (spec 11). CC-BY credits appear on the credits screen.

## Acceptance criteria

- With sound on, two devices whose clocks differ by 2 minutes play the aarti within 250 ms of each other after clock sync.
- Joining 90 s after the start begins playback at 90 s (±0.5 s).
- Twenty remote bells in one second never produce more than 4 simultaneous bell voices on a client.
- On a 3 GB-RAM Android phone, starting the aarti doesn't increase memory use by more than 30 MB.
- Every shipped audio file has a licence entry. The `add-asset` checks fail the build otherwise.

## Open decisions

1. **Recording source:** the owner supplies the recordings (ambience, aartis, bells) and a 24-hour schedule of what plays when (decided 2026-11-04). Each file still needs a licence entry before it ships. The background and meditation loops were also made by the owner with ElevenLabs (AI) on 2026-11-23, as interim sounds, with the same open plan question. They must not contain chant or mantra to be deployed (spec 11 § AI-generated content). The first two bell strikes were made by the owner with ElevenLabs sound effects (AI) on 2026-11-23, as interim sounds. Open: whether the ElevenLabs plan used allows commercial use without credit. Until that is confirmed, they are not deployed. If the schedule adds music or chant outside the aartis, the "no music outside aarti" principle above changes with it.
2. **Lyrics overlay** in M4 or M5.
3. **Distinct morning aarti,** or the same aarti both times with a different opening.
