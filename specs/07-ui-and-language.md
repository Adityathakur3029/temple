# 07 — UI and language

## Purpose

Screens, controls, wording, Hindi/English localisation, fonts and accessibility.

## Tone of voice

- Calm, short and warm. Address the visitor as "you" (आप in Hindi, never तुम).
- No exclamation marks, no gamified words (score, level, unlock, streak) and no urgency.
- Describe actions plainly: "Light a diya", not "Earn blessings".
- Hindi is written natively, not translated word by word. **Every Hindi string needs native-speaker review before launch.**

## Screens

| Screen | Contents |
|---|---|
| Boot | Temple mark, "Sannidhi", "Opening the temple doors". Language toggle (हिन्दी / English). Retry link after 15 s (CSS only) |
| Unsupported device | "This device can't show the temple." Offer: "Listen to the next aarti" (audio-only page) |
| Temple (HUD) | Top bar: hall chip ("Hall 3 · 27 here"), sound toggle, settings. Bottom: action dock and context button. Notices: aarti banner, queue status, connection state |
| Hall list (sheet) | All halls with counts. The current hall is marked. Full halls are disabled. "Counts update every few seconds" |
| Who's here (sheet) | Count and names in the viewer's language; today's counters; "Tap a person to see their name" |
| Mala view | Close-up mala, counter, mantra, close button (spec 03) |
| Settings (sheet) | Language; sound master and channels; Lite mode; movement joystick; reduced motion; aarti lyrics; credits; privacy; support the temple |
| Support the temple (sheet) | Donation sheet (spec 09) |
| Rest overlay | "Resting in another tab" / "Continue here", or idle "Resting. Tap to return." |
| Exit | "Thank you for visiting" + "Return to the temple"; low-key "Support the temple" link |

**Donation entry points:** only Settings and the Exit screen. Never in the action dock, on the sanctum, during aarti, or in loading screens.

## HUD

- **Action dock** (bottom, phone-thumb reach): Namaste · Bow · Japa · Darshan. Parikrama appears when near checkpoint `E`.
- **Context button:** one large button above the dock when near a ritual spot ("Ring bell", "Light a diya", "Offer water", "Sit", "Take aarti", "Receive prasad").
- **Notices:** one at a time, in priority order: connection problem > queue status > aarti banner > hint.
- **Visual style:** soft translucent panels tinted towards deodar green. Brass-coloured accents are reserved for the active state. Deities are never used as icons or decoration.
- **Safe areas:** respect `env(safe-area-inset-*)`. Every tap target is at least 44 × 44 px.

## Onboarding

On the first visit, show at most three hints, one at a time, each dismissed by doing the action:
1. "Drag to look around. Tap the path to walk." (चारों ओर देखने के लिए खींचें। चलने के लिए रास्ते पर टैप करें।)
2. At the gate: "Footwear is left at the gate." (जूते-चप्पल द्वार पर उतारे जाते हैं।)
3. Near the first bell: "Tap the bell to ring it." (घंटी बजाने के लिए उस पर टैप करें।)

Store completion in `localStorage` `sannidhi:onboarding-v1`.

## Keyboard

| Key | Action |
|---|---|
| `W A S D` / arrows | Walk |
| Drag / scroll | Look / zoom |
| `1` | Bow (pranam) |
| `2` | Open or close the japa mala |
| `3` | Namaste |
| `E` | Context action (ring bell, light diya, sit …) |
| `D` | Darshan view |
| `P` | Parikrama (when near the start) |
| `M` | Sound on/off |
| `Space` / `↓` | Next bead (in the mala view) |
| `Esc` | Close the current sheet or view |

Shortcuts are listed in Settings → Controls.

## Lite mode

- **Suggested automatically** (once, dismissible) when any of these is true:
  - `navigator.connection.saveData` is true;
  - `effectiveType` is `2g` or `3g`;
  - `navigator.deviceMemory` ≤ 2;
  - the first 10 s average under 24 fps.
- **Lite does all of these:**
  - Lite texture tier and a higher LOD bias;
  - fewer trees and no shadows;
  - a single ambience loop;
  - deltas at `LITE_TICK_HZ` (`lite=1` on the socket).
- Stored in `sannidhi:settings-v1`.

## Language

- **Default:** Hindi if `navigator.language` starts with `hi`, otherwise English. The visitor can switch on the boot screen or in Settings. Stored in `sannidhi:lang-v1`.
- **Page language:** `<html lang>` updates to `hi` or `en`.
- **Toggle labels:** each language is named in its own script in both locale files (`lang.hi` = हिन्दी, `lang.en` = English).
- **Boot screen:** the static boot screen carries both languages, filled in from the locale files at build time, and CSS shows the one matching `<html lang>`. A tiny inline script sets `<html lang>` before first paint, so it works before any module loads.
- **Digits:** Western digits (0–9) in both languages.
- **Time:**
  - Shown in the visitor's locale and time zone, with IST in brackets when they differ, for example "7:00 pm IST (1:30 pm GMT)".
  - In Hindi: "शाम 7:00 बजे".
- **Strings:**
  - One JSON file per locale (`i18n/en.json`, `i18n/hi.json`) with the same keys.
  - A test fails if any key is missing in either file.
  - Interpolation uses `{name}` placeholders.
- **Mantra display:** always Devanagari first, then romanisation: **ॐ नमः शिवाय** / *Om Namah Shivaya*. The scholarly transliteration (*oṃ namaḥ śivāya*) appears in an info tooltip.

## Fonts

- **UI:** Noto Sans Devanagari + Noto Sans, self-hosted WOFF2, subset to the characters used.
- **Mantras and headings:** Tiro Devanagari Hindi (it includes Latin), self-hosted.
- **Loading:** `font-display: swap`. Preload only the UI subset of the active language. Fonts count towards the initial download budget (spec 10).

## Starter string table

The keys are the canonical names in the locale files. Hindi strings need native review (status: draft).

| Key | English | Hindi (draft) |
|---|---|---|
| `boot.title` | Sannidhi | सन्निधि |
| `boot.opening` | Opening the temple doors | मंदिर के द्वार खुल रहे हैं |
| `boot.error` | Couldn't reach the temple. Check your connection and try again. | मंदिर तक नहीं पहुँच पाए। इंटरनेट जाँचकर फिर से कोशिश करें। |
| `boot.retry` | Try again | फिर से कोशिश करें |
| `unsupported.title` | This device can't show the temple | यह डिवाइस मंदिर नहीं दिखा सकता |
| `lang.hi` | हिन्दी | हिन्दी |
| `lang.en` | English | English |
| `hud.hall` | Hall {n} | कक्ष {n} |
| `hud.here` | {count} here | {count} लोग यहाँ |
| `action.namaste` | Namaste | नमस्ते |
| `action.pranam` | Bow | प्रणाम |
| `action.bell` | Ring bell | घंटी बजाएँ |
| `action.japa` | Japa | जप |
| `action.darshan` | Darshan | दर्शन |
| `action.parikrama` | Parikrama | परिक्रमा |
| `action.diya` | Light a diya | दीया जलाएँ |
| `action.jal` | Offer water | जल अर्पित करें |
| `action.bilva` | Offer bel patra | बेलपत्र अर्पित करें |
| `action.sit` | Sit | बैठें |
| `action.stand` | Stand up | उठें |
| `action.take_aarti` | Take aarti | आरती लें |
| `action.prasad` | Receive prasad | प्रसाद ग्रहण करें |
| `japa.count` | {bead} / 108 | {bead} / 108 |
| `japa.malas_today` | Malas today: {n} | आज की मालाएँ: {n} |
| `japa.turn` | Turn the mala here | यहाँ से माला पलटें |
| `parikrama.done` | Parikrama {n} complete | परिक्रमा {n} पूर्ण |
| `queue.ahead` | {n} ahead of you | आपसे पहले {n} लोग |
| `queue.turn` | Your turn | आपकी बारी |
| `queue.leave` | Leave queue | कतार छोड़ें |
| `diya.burning` | Your diya is burning | आपका दीया जल रहा है |
| `diya.has_lamp` | Your diya is still burning | आपका दीया अभी जल रहा है |
| `diya.stand_full` | All lamps are lit. A place frees in {min} min. | सभी दीये जल रहे हैं। {min} मिनट में जगह खाली होगी। |
| `aarti.morning` | Morning aarti | प्रातः आरती |
| `aarti.evening` | Evening aarti | संध्या आरती |
| `aarti.soon` | {name} begins at {time} | {name} {time} बजे आरंभ होगी |
| `aarti.now` | {name} has begun | {name} आरंभ हो गई है |
| `aarti.go` | Go to the mandapa | मंडप की ओर चलें |
| `aarti.listen` | Listen | सुनें |
| `aarti.mute_once` | Mute this aarti | इस आरती की ध्वनि बंद करें |
| `sound.on` | Turn sound on | ध्वनि चालू करें |
| `sound.off` | Turn sound off | ध्वनि बंद करें |
| `hall.full` | This hall is full. Please choose another. | यह कक्ष भरा हुआ है। कृपया दूसरा चुनें। |
| `conn.reconnecting` | Reconnecting… | फिर से जुड़ रहे हैं… |
| `conn.refresh` | A new version is ready. Refresh to continue. | नया संस्करण उपलब्ध है। जारी रखने के लिए रीफ़्रेश करें। |
| `rest.other_tab` | Resting in another tab | दूसरे टैब में विश्राम |
| `rest.continue` | Continue here | यहीं जारी रखें |
| `rest.idle` | Resting. Tap to return. | विश्राम में। लौटने के लिए टैप करें। |
| `today.title` | Today in the temple | आज मंदिर में |
| `today.diyas` | {n} diyas lit | {n} दीये जले |
| `today.malas` | {n} malas of japa | {n} माला जप |
| `today.parikramas` | {n} parikramas | {n} परिक्रमाएँ |
| `support.title` | Support the temple's upkeep | मंदिर की देखभाल में सहयोग करें |
| `support.note` | Your support pays for servers, artwork and recordings. It does not change anything inside the temple. | आपका सहयोग सर्वर, चित्रकारी और रिकॉर्डिंग में लगता है। इससे मंदिर के भीतर कुछ नहीं बदलता। |
| `support.open_upi` | Open UPI app | UPI ऐप खोलें |
| `support.copy_upi` | Copy UPI ID | UPI आईडी कॉपी करें |
| `exit.thanks` | Thank you for visiting | पधारने के लिए धन्यवाद |
| `exit.return` | Return to the temple | मंदिर में लौटें |

## Accessibility

- **Standard:** WCAG 2.2 AA for all DOM UI (contrast, focus visible, labels, target size).
- **Screen-reader announcements:** a polite live region for the visitor's own results ("Your diya is lit", "Parikrama 2 complete").
- **Remote activity** is summarised at most once every 10 s ("3 people greeted"), never announced one by one.
- **Reduced motion:** with `prefers-reduced-motion`, camera moves cut, flame flicker and tree sway are reduced, and the mala doesn't spin.
- **No flashing content.** The aarti lamp brightening has no strobe.
- **Audio has visual equivalents:** bells swing and show a small ring; aarti shows an "Aarti in progress" indicator and optional lyrics.
- **3D content is described:** a "Describe the scene" button in Settings reads a short description of the visitor's surroundings and what they can do there.

## Credits screen

Lists every asset with a credit requirement (spec 11), the sound credits (spec 06), the font licences, and "Made with Three.js". It is bilingual.

## Acceptance criteria

- Every string shown in the UI comes from the locale files, and both locales have every key (test).
- The whole HUD can be operated with the keyboard only, and with TalkBack on Android (manual check in M5).
- The donation sheet can't be reached from the action dock, the sanctum, or during aarti.
- At 360 × 640 px every HUD element is visible and tappable, with no overlap with the context button.

## Open decisions

1. **Hindi review.** Choose the native-speaker reviewer for the Hindi strings and set the review deadline before M5.
2. **Joystick or tap-to-walk** as the default on touch (default: tap-to-walk).
3. **Devanagari digits** in the Hindi UI (default: no).
