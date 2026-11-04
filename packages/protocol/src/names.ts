/**
 * The curated visitor names (spec 05 § Names). The server assigns `{ key, n }` on join: a key from
 * this list plus a number 100–999 that is unique within the instance. Clients show the label in
 * the viewer's language, for example "Deodar 214" or "देवदार 214".
 *
 * Himalayan nature words only: trees, flowers, birds, weather and landforms. The list must not
 * contain names of deities, saints, sacred rivers, sacred places or sacred plants; caste or
 * community surnames; or political, regional or brand words. Words with a ritual use (tulsi,
 * bilva, marigold, kamal) and words that are also a deity's name (surya, chandra, usha, neelkanth)
 * are left out on purpose, and so are words a number turns into something else ("धारा 420" reads as
 * a legal section) or that read as comic. The cultural reviewer checks every change. The Hindi labels are drafts
 * that need native review, like every Hindi string (spec 07).
 *
 * Keys are part of the wire format (`Visitor.name.key`): add keys freely, but removing or
 * renaming one is a breaking change.
 */

export interface NameLabel {
  readonly en: string;
  readonly hi: string;
}

export const NAMES = {
  // Trees and shrubs
  deodar: { en: "Deodar", hi: "देवदार" },
  buransh: { en: "Buransh", hi: "बुरांश" },
  bhojpatra: { en: "Bhojpatra", hi: "भोजपत्र" },
  kafal: { en: "Kafal", hi: "काफल" },
  oak: { en: "Oak", hi: "बलूत" },
  pine: { en: "Pine", hi: "चीड़" },
  fern: { en: "Fern", hi: "फ़र्न" },
  walnut: { en: "Walnut", hi: "अखरोट" },
  apricot: { en: "Apricot", hi: "खुमानी" },
  alder: { en: "Alder", hi: "उतीस" },
  cypress: { en: "Cypress", hi: "सुरई" },
  hisalu: { en: "Hisalu", hi: "हिसालू" },
  kilmora: { en: "Kilmora", hi: "किलमोड़ा" },
  // Flowers
  phyonli: { en: "Phyonli", hi: "फ्योंली" },
  jasmine: { en: "Jasmine", hi: "चमेली" },
  violet: { en: "Violet", hi: "बनफ़्शा" },
  // Birds
  monal: { en: "Monal", hi: "मोनाल" },
  koel: { en: "Koel", hi: "कोयल" },
  bulbul: { en: "Bulbul", hi: "बुलबुल" },
  chakor: { en: "Chakor", hi: "चकोर" },
  sparrow: { en: "Sparrow", hi: "गौरैया" },
  partridge: { en: "Partridge", hi: "तीतर" },
  // Weather and light
  megh: { en: "Megh", hi: "मेघ" },
  cloud: { en: "Cloud", hi: "बादल" },
  mist: { en: "Mist", hi: "धुंध" },
  dawn: { en: "Dawn", hi: "भोर" },
  dusk: { en: "Dusk", hi: "साँझ" },
  snow: { en: "Snow", hi: "बर्फ़" },
  rain: { en: "Rain", hi: "बारिश" },
  frost: { en: "Frost", hi: "पाला" },
  rainbow: { en: "Rainbow", hi: "धनक" },
  drizzle: { en: "Drizzle", hi: "फुहार" },
  // Landforms and water
  pahad: { en: "Pahad", hi: "पहाड़" },
  // "River" in English: "Nadi" is one letter from Nandi, who sits in this temple.
  nadi: { en: "River", hi: "नदी" },
  jharna: { en: "Jharna", hi: "झरना" },
  valley: { en: "Valley", hi: "घाटी" },
  bugyal: { en: "Bugyal", hi: "बुग्याल" },
  ridge: { en: "Ridge", hi: "धार" },
  lake: { en: "Lake", hi: "झील" },
  rock: { en: "Rock", hi: "चट्टान" },
  pebble: { en: "Pebble", hi: "कंकड़" },
  forest: { en: "Forest", hi: "वन" },
  glacier: { en: "Glacier", hi: "हिमनद" },
} as const satisfies Record<string, NameLabel>;

export type NameKey = keyof typeof NAMES;

export const NAME_KEYS = Object.keys(NAMES) as NameKey[];

/** The number part of a name: 100–999, unique within an instance. */
export const NAME_NUMBER_MIN = 100;
export const NAME_NUMBER_MAX = 999;

/**
 * Numbers never given: 108 (the japa count and a monastic title), 420 (a cheat, in Hindi slang),
 * 666 and 786 (numbers with a religious meaning). Reviewed by the cultural reviewer.
 */
export const NAME_NUMBERS_EXCLUDED: readonly number[] = [108, 420, 666, 786];

export function isNameKey(key: unknown): key is NameKey {
  return typeof key === "string" && Object.hasOwn(NAMES, key);
}

/**
 * "Deodar 214" / "देवदार 214". An unknown key (from a newer server) shows the number alone,
 * so an older client never shows raw wire data.
 */
export function nameLabel(name: { key: string; n: number }, lang: keyof NameLabel): string {
  return isNameKey(name.key) ? `${NAMES[name.key][lang]} ${name.n}` : String(name.n);
}
