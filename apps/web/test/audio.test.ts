import { describe, expect, it } from "vitest";
import { chooseBed, isNight, pickVariant } from "../src/audio/beds";
import { admitVoice, REMOTE_GAIN, PANNER } from "../src/audio/effects";
import { AUDIO_KEY, DEFAULT_AUDIO, Mixer, gainOf, parseAudioSettings } from "../src/audio/mixer";
import type { AssetManifest } from "../src/assets/manifest";
import { SOUNDS } from "../src/assets/sounds";
import { memoryStore } from "../src/platform/storage";
import { soundUrls } from "../src/scene/models";
import { istTimeOnDay } from "@sannidhi/protocol";

describe("audio settings (spec 06 § Channels, spec 09 audio-v1)", () => {
  it("starts with sound off and the spec's channel volumes", () => {
    expect(parseAudioSettings(null)).toEqual({
      on: false,
      master: 100,
      ambience: 60,
      effects: 70,
      chant: 80,
    });
  });

  it("keeps good fields and repairs bad ones", () => {
    const s = parseAudioSettings(JSON.stringify({ on: true, effects: 250, chant: "loud" }));
    expect(s).toEqual({ ...DEFAULT_AUDIO, on: true, effects: 100 });
    expect(parseAudioSettings("{not json")).toEqual(DEFAULT_AUDIO);
  });

  it("maps volume to gain: silent at 0, full at 100", () => {
    expect(gainOf(0)).toBe(0);
    expect(gainOf(100)).toBe(1);
    expect(gainOf(50)).toBeCloseTo(0.25);
  });

  it("saves the switch; without a browser audio context it stays silent", () => {
    const store = memoryStore();
    const win = new EventTarget() as unknown as Window;
    const mixer = new Mixer(store, win);
    let changes = 0;
    mixer.onChange(() => changes++);
    mixer.setOn(true);
    expect(JSON.parse(store.data.get(AUDIO_KEY) ?? "{}")).toMatchObject({ on: true });
    expect(mixer.audible).toBe(false);
    expect(mixer.context()).toBeNull();
    expect(changes).toBe(1);
    mixer.dispose();
  });
});

describe("effects (spec 06 § Spatial effects)", () => {
  it("caps voices and stops the oldest first", () => {
    const pool: number[] = [];
    for (let i = 1; i <= SOUNDS.bell.maxVoices; i++) expect(admitVoice(pool, i, 4)).toEqual([]);
    expect(admitVoice(pool, 5, 4)).toEqual([1]);
    expect(pool).toEqual([2, 3, 4, 5]);
  });

  it("twenty bells at once never leave more than 4 voices", () => {
    const pool: number[] = [];
    for (let i = 0; i < 20; i++) admitVoice(pool, i, SOUNDS.bell.maxVoices);
    expect(pool).toEqual([16, 17, 18, 19]);
  });

  it("plays remote sounds 6 dB quieter, panned the cheap way", () => {
    expect(20 * Math.log10(REMOTE_GAIN)).toBeCloseTo(-6);
    expect(PANNER).toMatchObject({
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 2,
      maxDistance: 40,
    });
    expect(SOUNDS.bell).toMatchObject({ channel: "effects", maxVoices: 4, pitchJitter: 0.03 });
  });

  it("lists each sound's variants from the manifest, in order", () => {
    const sound = (n: number) => ({
      src: `audio/bell-${n}.m4a`,
      sound: "bell" as const,
      path: `/v/abc/audio/bell-${n}.m4a`,
      sha256: "",
      bytes: 1,
      seconds: 6,
      tags: [],
      licence: "own" as const,
      credit: null,
    });
    const m: AssetManifest = {
      release: "abc",
      inputs: null,
      files: [],
      sounds: [sound(2), sound(1)],
    };
    expect(soundUrls(m)).toEqual({ bell: ["/v/abc/audio/bell-1.m4a", "/v/abc/audio/bell-2.m4a"] });
    expect(soundUrls({ release: null, inputs: null, files: [] })).toEqual({});
  });
});

describe("the bed: background, meditation and aarti (spec 06 § Background and meditation)", () => {
  const bed = (meditating: boolean, aarti: boolean, night: boolean) =>
    chooseBed({ meditating, aarti, night });

  it("plays the day background by day and the night one at night", () => {
    expect(bed(false, false, false)).toBe("background-day");
    expect(bed(false, false, true)).toBe("background-night");
  });

  it("plays the aarti instead of the background while it's on", () => {
    expect(bed(false, true, false)).toBe("aarti");
    expect(bed(false, true, true)).toBe("aarti");
  });

  it("meditation comes first, even during the aarti, and stopping it goes back", () => {
    for (const aarti of [false, true]) {
      for (const night of [false, true]) expect(bed(true, aarti, night)).toBe("meditation");
    }
    expect(bed(false, true, true)).toBe("aarti");
  });

  it("follows the IST night phase", () => {
    const day = Date.UTC(2026, 10, 23);
    expect(isNight(istTimeOnDay(day, "12:00"))).toBe(false);
    expect(isNight(istTimeOnDay(day, "06:00"))).toBe(false);
    expect(isNight(istTimeOnDay(day, "18:00"))).toBe(false);
    expect(isNight(istTimeOnDay(day, "19:00"))).toBe(true);
    expect(isNight(istTimeOnDay(day, "02:00"))).toBe(true);
  });

  it("picks any meditation, but not the same one twice in a row", () => {
    expect(pickVariant(1, 0, () => 0.9)).toBe(0);
    expect(pickVariant(4, -1, () => 0.99)).toBe(2);
    for (let last = 0; last < 4; last++) {
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const i = pickVariant(4, last, () => r);
        expect(i).not.toBe(last);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(4);
      }
    }
  });

  it("loops are stereo and never faded; meditation loads only on demand", () => {
    for (const id of ["background-day", "background-night", "meditation"] as const) {
      expect(SOUNDS[id].kind).toBe("loop");
      expect(SOUNDS[id].format.fadeOutS).toBe(0);
      expect(SOUNDS[id].format.channels).toBe(2);
    }
    expect(SOUNDS.meditation.onDemand).toBe(true);
    expect(SOUNDS["background-day"].onDemand).toBe(false);
  });
});
