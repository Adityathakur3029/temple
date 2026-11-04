# 06 — Sound and aarti

## Purpose

What visitors hear, how sound is mixed, how the aarti plays in sync for everyone, and where recordings come from.

## Principles

- **Quiet by default.** Sound stays off until the visitor turns it on (browsers require a tap anyway). Outside aarti there is no music, only the forest and the temple.
- **Never essential.** Every sound has a visual counterpart (spec 07).
- **Authentic and licensed.** Recordings are made for us or properly licensed (see [Licensing](#licensing)).

## Channels

| Channel | Contains | Default volume |
|---|---|---|
| Ambience | Wind in deodars, the kund's spring, birds (day), crickets and owl (night), very distant valley sounds | 40 |
| Effects | Bells, match strike, water pour, bead clicks, footsteps on stone (optional), conch at aarti start | 70 |
| Chant | The aarti recording; the optional personal "Om Namah Shivaya" loop | 80 |

- A **master switch** plus per-channel volume (0–100), stored in `localStorage` key `sannidhi:audio-v1`.
- Built with the Web Audio API: one `AudioContext`, a gain node per channel, then the master gain.
- **Unlock:** the context is created or resumed on the first user gesture. The HUD shows "Turn sound on" until then, and the aarti banner repeats the prompt.

## Spatial effects

- Remote visitors' bells, water and matches use `PannerNode` with the `equalpower` model (cheaper than HRTF on low-end phones), `inverse` distance model, `refDistance` 2 m and `maxDistance` 40 m.
- Your own actions play non-spatial at full channel volume. Remote actions are 6 dB quieter at equal distance.
- **Voice caps:** at most 4 bell voices and 6 other effect voices at once. New sounds beyond the cap steal the oldest.
- Short effects are decoded once into `AudioBuffer`s.

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

1. **Recording source:** commission (preferred) or license one, and the budget.
2. **Lyrics overlay** in M4 or M5.
3. **Distinct morning aarti,** or the same aarti both times with a different opening.
