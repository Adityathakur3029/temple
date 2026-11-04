import { describe, expect, it } from "vitest";
import { IDLE_SLEEP_MS, MATS, VIEW_CHECKPOINT_MS } from "@sannidhi/protocol";
import { FrameSampler, decide, suggestLiteAtStart } from "../src/platform/adapt";
import { IdleMonitor, type Activity } from "../src/platform/idle";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SettingsStore,
  parseSettings,
} from "../src/platform/settings";
import { memoryStore } from "../src/platform/storage";
import { RENDER_OWNER_KEY, RenderOwner, type ChannelLike } from "../src/platform/tabs";
import { chooseTier, gpuTier, lowerTier, pixelRatio } from "../src/platform/tier";
import { VIEW_KEY, loadView, saveView, type ViewCheckpoint } from "../src/platform/view";

describe("device tiers (spec 10 § Device tiers)", () => {
  it.each([
    ["ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)", true, "low"],
    ["Mali-G57 MC2", true, "mid"],
    ["Mali-G78 MP14", true, "high"],
    ["Mali-T830", true, "low"],
    ["Adreno (TM) 506", true, "low"],
    ["Adreno (TM) 610", true, "mid"],
    ["Adreno (TM) 619", true, "mid"],
    ["Adreno (TM) 660", true, "high"],
    ["PowerVR Rogue GE8320", true, "low"],
    ["Apple GPU", true, "mid"],
    ["Apple GPU", false, "high"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", false, "high"],
    ["ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11)", false, "mid"],
    [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      false,
      "low",
    ],
    [undefined, true, "mid"],
    [undefined, false, "high"],
  ] as const)("%s (mobile %s) → %s", (renderer, mobile, tier) => {
    expect(gpuTier(renderer, mobile)).toBe(tier);
  });

  it("never starts above what memory and cores allow", () => {
    const desktop = "NVIDIA GeForce RTX 3060";
    expect(chooseTier({ renderer: desktop, mobile: false })).toBe("high");
    expect(chooseTier({ renderer: desktop, mobile: false, deviceMemory: 2 })).toBe("low");
    expect(chooseTier({ renderer: desktop, mobile: false, deviceMemory: 4 })).toBe("mid");
    expect(chooseTier({ renderer: desktop, mobile: false, cores: 2 })).toBe("low");
    expect(chooseTier({ renderer: "Adreno (TM) 506", mobile: true, deviceMemory: 8 })).toBe("low");
  });

  it("renders Low at 0.7 and High at 1.0 of a pixel ratio capped at 2", () => {
    expect(pixelRatio("low", 3)).toBeCloseTo(1.4);
    expect(pixelRatio("high", 3)).toBe(2);
    expect(pixelRatio("high", 1)).toBe(1);
    expect(pixelRatio("mid", 2)).toBeCloseTo(1.8);
  });

  it("drops one tier at a time, and not below Low", () => {
    expect(lowerTier("high")).toBe("mid");
    expect(lowerTier("mid")).toBe("low");
    expect(lowerTier("low")).toBeNull();
  });
});

describe("Lite detection and the 10 s check (spec 07 § Lite mode, spec 10)", () => {
  it.each([
    [{ saveData: true }, true],
    [{ effectiveType: "2g" }, true],
    [{ effectiveType: "3g" }, true],
    [{ effectiveType: "4g" }, false],
    [{ deviceMemory: 2 }, true],
    [{ deviceMemory: 4 }, false],
    [{}, false],
  ])("%o → suggest %s", (signals, expected) => {
    expect(suggestLiteAtStart(signals)).toBe(expected);
  });

  it("averages frame rate over each 10 s window", () => {
    const s = new FrameSampler();
    let fps: number | null = null;
    for (let i = 0; i < 300 && fps === null; i++) fps = s.add(1000 / 30);
    expect(fps).toBeCloseTo(30, 0);
    expect(s.add(5000)).toBeNull(); // a paused loop is not a frame
  });

  it("drops the tier when under target, on automatic quality only", () => {
    expect(
      decide({ tier: "high", auto: true, fps: 40, lite: false, liteSuggested: false }).tier,
    ).toBe("mid");
    expect(
      decide({ tier: "high", auto: false, fps: 40, lite: false, liteSuggested: false }).tier,
    ).toBeNull();
    expect(
      decide({ tier: "mid", auto: true, fps: 31, lite: false, liteSuggested: false }).tier,
    ).toBeNull();
  });

  it("suggests Lite once, when the first windows average under 24 fps or Low is under target", () => {
    expect(
      decide({ tier: "mid", auto: true, fps: 20, lite: false, liteSuggested: false }).suggestLite,
    ).toBe(true);
    expect(
      decide({ tier: "low", auto: true, fps: 26, lite: false, liteSuggested: false }).suggestLite,
    ).toBe(true);
    expect(
      decide({ tier: "low", auto: true, fps: 20, lite: false, liteSuggested: true }).suggestLite,
    ).toBe(false);
    expect(
      decide({ tier: "low", auto: true, fps: 20, lite: true, liteSuggested: false }).suggestLite,
    ).toBe(false);
    expect(
      decide({ tier: "high", auto: true, fps: 58, lite: false, liteSuggested: false }).suggestLite,
    ).toBe(false);
  });
});

describe("settings (spec 09 § Browser storage keys)", () => {
  it("falls back to defaults for missing or malformed values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{nope")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"lite":"yes","tier":"ultra","reducedMotion":1}')).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(parseSettings('{"lite":true,"tier":"low","reducedMotion":false}')).toMatchObject({
      lite: true,
      tier: "low",
      reducedMotion: false,
    });
  });

  it("stores changes and tells listeners what changed", () => {
    const store = memoryStore();
    const s = new SettingsStore(store);
    const seen: string[][] = [];
    s.subscribe((_v, changed) => seen.push([...changed]));
    s.update({ lite: true, tier: "auto" });
    s.update({ lite: true });
    expect(seen).toEqual([["lite"]]);
    expect(JSON.parse(store.data.get(SETTINGS_KEY) ?? "{}")).toMatchObject({ lite: true });
    expect(new SettingsStore(store).get().lite).toBe(true);
  });
});

describe("one rendering tab (spec 10 § Background, tabs and idle)", () => {
  /** Fake BroadcastChannels that deliver to every other member, like the real one. */
  function bus(): () => ChannelLike {
    const members: ChannelLike[] = [];
    return () => {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage: (m) => {
          for (const other of members) if (other !== ch) other.onmessage?.({ data: m });
        },
        close: () => void members.splice(members.indexOf(ch), 1),
      };
      members.push(ch);
      return ch;
    };
  }

  it("moves rendering to the tab that claims it last", () => {
    const open = bus();
    const store = memoryStore();
    let now = 1000;
    const changes: string[] = [];
    const a = new RenderOwner({
      id: "a",
      channel: open(),
      store,
      now: () => now,
      onChange: (o) => changes.push(`a:${o}`),
    });
    const b = new RenderOwner({
      id: "b",
      channel: open(),
      store,
      now: () => now,
      onChange: (o) => changes.push(`b:${o}`),
    });
    a.claim();
    expect([a.isOwner, b.isOwner]).toEqual([true, false]);
    now += 10;
    b.claim();
    expect([a.isOwner, b.isOwner]).toEqual([false, true]);
    now += 10;
    a.claim(); // "Continue here"
    expect([a.isOwner, b.isOwner]).toEqual([true, false]);
    // The other tab hears a claim before the claimer finishes, so it yields first.
    expect(changes).toEqual(["a:true", "a:false", "b:true", "b:false", "a:true"]);
    expect(JSON.parse(store.data.get(RENDER_OWNER_KEY) ?? "{}")).toMatchObject({ id: "a" });
  });

  it("ignores a stale claim, so two tabs claiming at once keep one owner", () => {
    const store = memoryStore();
    const a = new RenderOwner({
      id: "a",
      channel: null,
      store,
      now: () => 500,
      onChange: () => {},
    });
    a.claim();
    a.storageChanged(JSON.stringify({ t: "claim", id: "b", at: 400 }));
    expect(a.isOwner).toBe(true);
    // A tie goes to the larger id in both tabs: "0" loses to "a", and "a" loses to "b".
    a.storageChanged(JSON.stringify({ t: "claim", id: "0", at: 500 }));
    expect(a.isOwner).toBe(true);
    a.storageChanged(JSON.stringify({ t: "claim", id: "b", at: 500 }));
    expect(a.isOwner).toBe(false);
  });

  it("works through localStorage events where BroadcastChannel is missing", () => {
    const a = new RenderOwner({
      id: "a",
      channel: null,
      store: memoryStore(),
      now: () => 1,
      onChange: () => {},
    });
    a.claim();
    a.storageChanged(JSON.stringify({ t: "claim", id: "b", at: 2 }));
    expect(a.isOwner).toBe(false);
    a.storageChanged("not json");
    a.storageChanged(null);
    expect(a.isOwner).toBe(false);
  });
});

describe("idle and calm modes (spec 10 § Background, tabs and idle)", () => {
  function monitor(): { idle: IdleMonitor; advance(ms: number): void; changes: Activity[] } {
    let now = 0;
    const changes: Activity[] = [];
    const idle = new IdleMonitor({ now: () => now, onChange: (a) => changes.push(a) });
    return { idle, changes, advance: (ms) => void (now += ms) };
  }

  it("rests after IDLE_SLEEP_MS without input when walking about", () => {
    const m = monitor();
    m.advance(IDLE_SLEEP_MS - 1);
    m.idle.tick(false);
    expect(m.idle.activity).toBe("active");
    m.advance(1);
    m.idle.tick(false);
    expect(m.idle.activity).toBe("rest");
  });

  it("goes calm instead while seated, and rests if the visitor is no longer seated", () => {
    const m = monitor();
    m.advance(IDLE_SLEEP_MS);
    m.idle.tick(true);
    expect(m.idle.activity).toBe("calm");
    m.idle.tick(false);
    expect(m.idle.activity).toBe("rest");
  });

  it("stays at rest until input, then returns", () => {
    const m = monitor();
    m.advance(IDLE_SLEEP_MS);
    m.idle.tick(false);
    m.idle.tick(true);
    expect(m.idle.activity).toBe("rest");
    m.idle.poke();
    expect(m.idle.activity).toBe("active");
    expect(m.changes).toEqual(["rest", "active"]);
  });
});

describe("view restore (spec 10 § Background, tabs and idle)", () => {
  const view: ViewCheckpoint = {
    at: 1_000_000,
    camera: { mode: "darshan", yaw: 1, pitch: 0.2, distance: 5 },
    me: { x: 4, z: 16, yaw: 3, mat: -1 },
  };

  it("restores a recent view", () => {
    const store = memoryStore();
    saveView(store, view);
    expect(loadView(store, view.at + VIEW_CHECKPOINT_MS)).toEqual(view);
  });

  it("forgets a view older than VIEW_CHECKPOINT_MS", () => {
    const store = memoryStore();
    saveView(store, view);
    expect(loadView(store, view.at + VIEW_CHECKPOINT_MS + 1)).toBeNull();
  });

  it("keeps the mat, hall, instance and bead when valid", () => {
    const store = memoryStore();
    const seated = {
      ...view,
      me: { ...(MATS[5] ?? view.me), mat: 5 },
      hall: "hall-03" as const,
      instance: 2,
      bead: 54,
    };
    saveView(store, seated);
    expect(loadView(store, view.at)).toEqual(seated);
  });

  it.each([
    ["a position inside the garbhagriha", { ...view, me: { ...view.me, x: 0, z: 0 } }],
    ["a position on the Nandi axis", { ...view, me: { ...view.me, x: 0, z: 10 } }],
    ["a mat that doesn't exist", { ...view, me: { ...view.me, mat: 40 } }],
    ["a camera mode that doesn't exist", { ...view, camera: { ...view.camera, mode: "free" } }],
    ["non-numbers", { ...view, me: { ...view.me, x: "4" } }],
  ])("rejects %s", (_name, bad) => {
    const store = memoryStore({ [VIEW_KEY]: JSON.stringify(bad) });
    expect(loadView(store, view.at)).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(loadView(memoryStore({ [VIEW_KEY]: "{" }), view.at)).toBeNull();
  });
});
