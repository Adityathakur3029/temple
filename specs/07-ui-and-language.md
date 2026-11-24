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
| Boot | Temple mark, "Sannidhi", "Opening the temple doors". Language toggle (हिन्दी / English). Retry link after 15 s (CSS only). On a first visit, the boot notice (below) |
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

## Boot notice

On the first visit, the boot screen shows a short notice above the language toggle, in the chosen language: who the temple is for (anyone who can't visit a temple in person, such as because of illness, a hospital stay, age or distance), that it is made with respect and isn't meant to hurt anyone's religious feelings, that the temple is fictional and doesn't replace worship, that it isn't medical care or advice, and that offerings are symbolic (strings `notice.*`). The boot screen stays until the visitor taps "Enter the temple". The scene bundle downloads meanwhile, but the temple and the hall connection only start after Enter, so nobody appears in a hall while reading. Store it in `localStorage` `sannidhi:notice-v1` so later visits skip it. If storage is blocked, the notice shows on every visit. The wording is a plain-language notice, not legal advice. Get a lawyer to review it before launch (spec 09 § Legal checklist).

## HUD

- **Action dock** (bottom, phone-thumb reach): Namaste · Bow · Japa · Darshan · Meditate. Parikrama appears when near checkpoint `E`. Meditate is a toggle (pressed while it plays) and is hidden when no meditation file is built (spec 06 § Background and meditation).
- **Context button:** one large button above the dock when near a ritual spot ("Ring bell", "Light a diya", "Offer water", "Sit", "Take aarti", "Receive prasad").
- **Notices:** one at a time, in priority order: connection problem > queue status > aarti banner > hint.
- **Visual style:** soft translucent panels tinted towards deodar green. Brass-coloured accents are reserved for the active state. Deities are never used as icons or decoration.
- **Safe areas:** respect `env(safe-area-inset-*)`. Every tap target is at least 44 × 44 px.

## Onboarding

On the first visit, show at most three hints, one at a time, each dismissed by doing the action:
1. "Drag to look around. Tap the path to walk." (चारों ओर देखने के लिए खींचें। चलने के लिए रास्ते पर टैप करें।)
2. At the gate: "Footwear is left at the gate." (जूते-चप्पल द्वार पर उतारे जाते हैं।) If the visitor has not washed their hands this visit, it adds "You may wash your hands at the taps before entering." (चाहें तो प्रवेश से पहले नल पर हाथ धो लें।) (spec 03 § Wash hands). Nothing is blocked.
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
| `V` | Darshan view (not `D`, which walks right) |
| `P` | Parikrama (when near the start) |
| `M` | Sound on/off |
| `Space` / `↓` | Next bead (in the mala view) |
| `Esc` | Close the current sheet or view |

Shortcuts are listed in Settings → Controls.

## Lite mode

- **Suggested automatically** (once, dismissible, as a notice with "Use Lite mode" and "Not now") when any of these is true:
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

The keys are the canonical names in the locale files. Hindi strings need native review (status: draft). A test checks that `en.json` and `hi.json` match this table exactly, so a new string is added here first. Hindi announcements avoid verb forms that change with the visitor's gender.

| Key | English | Hindi (draft) |
|---|---|---|
| `boot.title` | Sannidhi | सन्निधि |
| `boot.opening` | Opening the temple doors | मंदिर के द्वार खुल रहे हैं |
| `boot.error` | Couldn't reach the temple. Check your connection and try again. | मंदिर तक नहीं पहुँच पाए। इंटरनेट जाँचकर फिर से कोशिश करें। |
| `boot.retry` | Try again | फिर से कोशिश करें |
| `unsupported.title` | This device can't show the temple | यह डिवाइस मंदिर नहीं दिखा सकता |
| `lang.hi` | हिन्दी | हिन्दी |
| `lang.en` | English | English |
| `notice.title` | Before you enter | प्रवेश से पहले |
| `notice.purpose` | Sannidhi is a quiet place for anyone who cannot visit a temple in person, whether because of illness, a hospital stay, age or distance. It is made with devotion and respect, and is not meant to hurt anyone's religious feelings or beliefs. | सन्निधि उन सबके लिए एक शांत स्थान है जो बीमारी, अस्पताल में भर्ती होने, आयु या दूरी के कारण मंदिर नहीं जा पाते। इसे श्रद्धा और सम्मान से बनाया गया है। इसका उद्देश्य किसी की धार्मिक भावनाओं या आस्था को ठेस पहुँचाना नहीं है। |
| `notice.fictional` | This temple is imaginary. It does not represent any real temple, trust or religious organisation, and it does not replace worship at a temple or at home. | यह मंदिर काल्पनिक है। यह किसी वास्तविक मंदिर, ट्रस्ट या धार्मिक संस्था का प्रतिनिधित्व नहीं करता, और मंदिर या घर में की जाने वाली पूजा का स्थान नहीं लेता। |
| `notice.medical` | This is not medical care or advice. If you are unwell, please follow your doctor's guidance. | यह चिकित्सा सेवा या चिकित्सकीय सलाह नहीं है। अस्वस्थ हों तो कृपया अपने डॉक्टर की सलाह का पालन करें। |
| `notice.symbolic` | Offerings here are symbolic. No blessing, wish or result is promised. | यहाँ के अर्पण प्रतीकात्मक हैं। किसी आशीर्वाद, मनोकामना या फल का वादा नहीं किया जाता। |
| `notice.enter` | Enter the temple | मंदिर में प्रवेश करें |
| `hud.hall` | Hall {n} | कक्ष {n} |
| `hud.here` | {count} here | {count} उपस्थित |
| `action.namaste` | Namaste | नमस्ते |
| `action.pranam` | Bow | प्रणाम |
| `action.bell` | Ring bell | घंटी बजाएँ |
| `action.japa` | Japa | जप |
| `action.darshan` | Darshan | दर्शन |
| `action.meditate` | Meditate | ध्यान |
| `action.parikrama` | Parikrama | परिक्रमा |
| `action.diya` | Light a diya | दीया जलाएँ |
| `action.jal` | Offer water | जल अर्पित करें |
| `action.bilva` | Offer bel patra | बेलपत्र अर्पित करें |
| `action.flower` | Offer a flower | पुष्प अर्पित करें |
| `action.charanamrit` | Receive charanamrit | चरणामृत ग्रहण करें |
| `action.sit` | Sit | बैठें |
| `action.stand` | Stand up | उठें |
| `action.take_aarti` | Take aarti | आरती लें |
| `action.prasad` | Receive prasad | प्रसाद ग्रहण करें |
| `action.wash` | Wash hands | हाथ धोएँ |
| `action.shringa` | Darshan between Nandi's horns | नंदी के सींगों के बीच से दर्शन |
| `action.shringa_back` | Back | वापस |
| `action.whisper` | Whisper to Nandi | नंदी के कान में अपनी बात कहें |
| `japa.count` | {bead} / 108 | {bead} / 108 |
| `japa.malas_today` | Malas today: {n} | आज की मालाएँ: {n} |
| `japa.turn` | Turn the mala here | यहाँ से माला पलटें |
| `parikrama.done` | Parikrama {n} complete | परिक्रमा {n} पूर्ण |
| `queue.ahead` | {n} ahead of you | कतार में आपसे आगे: {n} |
| `queue.turn` | Your turn | आपकी बारी |
| `queue.leave` | Leave queue | कतार छोड़ें |
| `jal.cooldown` | You can offer again in a few minutes. | कुछ मिनट बाद फिर से अर्पण किया जा सकता है। |
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
| `board.title` | Aarti timings | आरती का समय |
| `board.time_morning` | {time} AM | सुबह {time} बजे |
| `board.time_evening` | {time} PM | शाम {time} बजे |
| `sound.on` | Turn sound on | ध्वनि चालू करें |
| `sound.off` | Turn sound off | ध्वनि बंद करें |
| `hall.full` | This hall is full. Please choose another. | यह कक्ष भरा हुआ है। कृपया दूसरा चुनें। |
| `conn.reconnecting` | Reconnecting… | फिर से जुड़ने की कोशिश हो रही है… |
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
| `hud.dock` | Actions | कार्य |
| `settings.title` | Settings | सेटिंग्स |
| `settings.close` | Close | बंद करें |
| `settings.language` | Language | भाषा |
| `settings.lite` | Lite mode | लाइट मोड |
| `settings.lite_note` | Uses less data and battery, with fewer trees and simpler light. | इसमें डेटा और बैटरी कम लगती है; पेड़ कम और रोशनी सादी रहती है। |
| `settings.quality` | Picture quality | दृश्य गुणवत्ता |
| `settings.quality_auto` | Automatic | अपने-आप |
| `settings.quality_low` | Low | कम |
| `settings.quality_mid` | Medium | मध्यम |
| `settings.quality_high` | High | उच्च |
| `settings.motion` | Reduce motion | एनिमेशन कम करें |
| `settings.controls` | Controls | नियंत्रण |
| `controls.walk` | Walk | चलें |
| `controls.drag` | Drag or scroll | खींचें या स्क्रॉल करें |
| `controls.look` | Look around and zoom | चारों ओर देखें और ज़ूम करें |
| `controls.context` | Action at this spot (ring bell, wash hands, sit, stand up) | इस जगह का कार्य (घंटी बजाएँ, हाथ धोएँ, बैठें, उठें) |
| `controls.darshan` | Darshan view | दर्शन दृश्य |
| `controls.close` | Close the open sheet or view | खुला पैनल या दृश्य बंद करें |
| `lite.suggest` | This device may run more smoothly in Lite mode. | लाइट मोड में यह डिवाइस बेहतर चल सकता है। |
| `lite.use` | Use Lite mode | लाइट मोड चालू करें |
| `lite.dismiss` | Not now | अभी नहीं |
| `a11y.seated` | You are on a mat, facing the sanctum. | आप आसन पर हैं, मुख गर्भगृह की ओर है। |
| `a11y.seated.bench` | You are on a bench, facing the temple. | आप बेंच पर हैं, मुख मंदिर की ओर है। |
| `a11y.stood` | You left the mat. | आपने आसन छोड़ दिया। |
| `a11y.darshan` | Darshan view: the linga, through the sanctum door. | दर्शन दृश्य: गर्भगृह के द्वार से शिवलिंग। |
| `action.namaste_label` | Namaste — greet everyone | नमस्ते — सबका अभिवादन करें |
| `halls.title` | Halls | कक्ष |
| `halls.note` | Counts update every few seconds | गिनती हर कुछ सेकंड में अपडेट होती है |
| `halls.current` | You are here | आप यहाँ हैं |
| `halls.full` | Full | भरा हुआ |
| `halls.choose` | Choose another hall | दूसरा कक्ष चुनें |
| `who.title` | Who's here | यहाँ कौन-कौन है |
| `who.hint` | Tap a person to see their name | नाम देखने के लिए किसी व्यक्ति पर टैप करें |
| `who.you` | {name} (you) | {name} (आप) |
| `who.alone` | No one else is here just now. | अभी यहाँ और कोई नहीं है। |
| `today.visits` | {n} visits | {n} आगमन |
| `mat.taken` | This mat is taken. Please choose another. | यह आसन किसी और के पास है। कृपया दूसरा चुनें। |
| `bench.taken` | There is no room on this bench. Please choose another. | इस बेंच पर जगह नहीं है। कृपया दूसरी बेंच चुनें। |
| `conn.offline` | Couldn't reach the other visitors. You can still walk in the temple. | अन्य दर्शनार्थियों से संपर्क नहीं हो पाया। फिर भी मंदिर में चलना-फिरना जारी रखें। |
| `conn.waiting` | Reconnecting in a minute… | एक मिनट में फिर से जुड़ने की कोशिश होगी… |
| `conn.refresh_now` | Refresh | रीफ़्रेश करें |
| `a11y.namaste` | You greeted everyone. | आपने सबका अभिवादन किया। |
| `a11y.pranam` | You bowed. | आपने प्रणाम किया। |
| `a11y.bell` | You rang the bell. | आपने घंटी बजाई। |
| `a11y.wash` | You washed your hands. | आपने हाथ धो लिए। |
| `a11y.shringa` | Darshan between Nandi's horns: the linga, through the sanctum door. | नंदी के सींगों के बीच से दर्शन: गर्भगृह के द्वार से शिवलिंग। |
| `a11y.whisper` | You whispered your prayer to Nandi. | आपने नंदी के कान में अपनी प्रार्थना कही। |
| `a11y.jal` | You offered water. | आपने जल अर्पित किया। |
| `a11y.bilva` | You offered a bel patra. | आपने बेलपत्र अर्पित किया। |
| `a11y.flower` | You offered a flower. | आपने पुष्प अर्पित किया। |
| `a11y.charanamrit` | You received charanamrit. | आपने चरणामृत ग्रहण किया। |
| `a11y.others_namaste_one` | Someone greeted everyone. | किसी ने सबका अभिवादन किया। |
| `a11y.others_namaste` | {n} people greeted everyone. | {n} लोगों ने सबका अभिवादन किया। |
| `a11y.others_pranam_one` | Someone bowed. | किसी ने प्रणाम किया। |
| `a11y.others_pranam` | {n} people bowed. | {n} लोगों ने प्रणाम किया। |
| `a11y.others_bell_one` | A bell rang. | एक घंटी बजी। |
| `a11y.others_bell` | Bells rang {n} times. | {n} बार घंटी बजी। |
| `hint.gate` | Footwear is left at the gate. | जूते-चप्पल द्वार पर उतारे जाते हैं। |
| `hint.gate_wash` | Footwear is left at the gate. You may wash your hands at the taps before entering. | जूते-चप्पल द्वार पर उतारे जाते हैं। चाहें तो प्रवेश से पहले नल पर हाथ धो लें। |

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
