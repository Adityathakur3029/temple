/**
 * The temple: the greybox world, the visitor's avatar, orbit and darshan cameras, tap-to-walk and
 * keyboard walking, day and night on IST, device tiers and Lite mode, one rendering tab, idle and
 * calm modes and view restore (M1), and presence (M2): other visitors, namaste, pranam, bells,
 * mats, the hall list and "Who's here". Models in asset slots replace greybox shapes as they load
 * (scene/models.ts, spec 11).
 * Without a connection the temple keeps working alone, as in M1.
 */
import {
  CanvasTexture,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import {
  BELL_COOLDOWN_MS,
  BELL_IDS,
  BELL_REACH_M,
  BELLS,
  COURTYARD,
  GANESHA,
  GANESHA_BOW_M,
  GATE,
  INTERP_DELAY_MS,
  LITE_INTERP_DELAY_MS,
  BENCHES,
  BENCH_HALF_DEPTH,
  BENCH_HALF_LENGTH,
  BENCH_SIT_NEAR_M,
  MATS,
  MAT_COUNT,
  SEATS,
  seatKind,
  PRADAKSHINA_MODE,
  SEAT_REACH_M,
  SPAWN,
  TAP_IDS,
  TAP_SPOTS,
  WASH_COOLDOWN_MS,
  blockedAt,
  bowTarget,
  distance,
  inMandapa,
  inShape,
  isHallId,
  istTimeOnDay,
  nameLabel,
  phaseBlend,
  yawTowards,
  type BellId,
  type Point,
  type Spot,
  type Pose,
  type StateTuple,
  type TapId,
  type Visitor,
  type VisitorId,
  CHARANAMRIT_SPOTS,
  CHARANAMRIT_WINDOW_MS,
  JAL_COOLDOWN_MS,
  JAL_NEAR_M,
  JAL_SIDES,
  JAL_SPOTS,
  LAY_SPOTS,
  OFFERING_PLATES,
  PICK_SPOTS,
  jalDistance,
  nearestJalSide,
  TIRTHA_POTS,
  type JalKind,
  type JalNoMessage,
  type JalQueueMessage,
  type JalTurnMessage,
  NANDI_EAR_REACH_M,
  NANDI_EAR_SPOTS,
  NANDI_HEAD,
  SHRINGA_REACH_M,
  SHRINGA_SPOT,
  RATE_LIMITS,
} from "@sannidhi/protocol";
import { currentLang } from "../i18n/lang";
import { realtimeBase, socketBase } from "../net/config";
import type { NetStatus } from "../net/connection";
import { Session } from "../net/session";
import { Hud, type ContextAction, type Gesture } from "../ui/hud";
import { Beds } from "../audio/beds";
import { Effects } from "../audio/effects";
import { Mixer } from "../audio/mixer";
import { decide, FrameSampler, readLiteSignals, suggestLiteAtStart } from "../platform/adapt";
import { CALM_FPS, IdleMonitor } from "../platform/idle";
import { SettingsStore } from "../platform/settings";
import { localStore, sessionStore } from "../platform/storage";
import { openChannel, RENDER_OWNER_KEY, RenderOwner } from "../platform/tabs";
import { chooseTier, pixelRatio, readDeviceInfo, type Tier } from "../platform/tier";
import { loadView, saveView } from "../platform/view";
import {
  Avatar,
  CHARANAMRIT_S,
  GESTURE_S,
  HEAD_HEIGHT,
  LAY_RELEASE_S,
  WHISPER_S,
  disposeAvatarCache,
  prebuildAvatarGeometries,
} from "./avatar";
import { BellSwings } from "./bells";
import { TapWater, nearTrough, nearestTap, tapInReach } from "./taps";
import { CameraRig, clampOrbit, type CameraPose } from "./camera";
import { Crowd } from "./crowd";
import { Offerings } from "./offerings";
import { PLINTH, groundY } from "./ground";
import { buildGreybox, MAX_TREES } from "./greybox";
import { Input } from "./input";
import { FIRST_VIEW_WAIT_MS, SceneModels, soundUrls } from "./models";
import { NavGrid } from "./nav";
import { PerfOverlay } from "./perf";
import { blendLook, Sky, SUN_SHADOW_DISTANCE } from "./sky";
import { Walker, type MoveInput } from "./walker";

/** Lite mode keeps the nearest 72 trees (spec 11). */
export const LITE_TREES = 72;
/** Radians of camera turn per CSS pixel dragged. */
const LOOK_RAD_PER_PX = 0.005;
/** `jal.request` at most this often (the server allows one a second). */
const JAL_ASK_GAP_MS = RATE_LIMITS["jal.request"].everyMs + 100;
/** A request with no reply by then is given up. */
const JAL_ASK_TIMEOUT_MS = 4000;
/** The pause at the offering bench while the lota, leaf or flower is taken up. */
const JAL_PICK_S = 1.2;
/** The water reaches the channel this far into the 8 s pour (spec 03). */
const POUR_OUTFLOW_S = 4.5;
/** Tap-to-walk eases the camera round behind the visitor this long after the last look. */
const FOLLOW_AFTER_LOOK_MS = 2500;
const CHECKPOINT_MS = 2000;
const SKY_UPDATE_MS = 1000;
const HEAD_STANDING = HEAD_HEIGHT.standing;
const HEAD_SEATED = HEAD_HEIGHT.seated;
const MAT_TOP = 0.025;
/** A hidden tab keeps its socket this long, so a quick app switch doesn't drop presence (spec 10). */
export const HIDDEN_KEEP_MS = 120_000;
/** A tapped visitor's name shows this long (spec 02 § Avatar). */
const NAME_TAG_MS = 3000;

/** Point lights at full strength; at most 4, and 2 on the Low tier (spec 02, spec 10). */
const LIGHTS = {
  sanctum: { color: "#ffb45a", intensity: 18, distance: 9, at: [0, PLINTH + 1.6, 1.5] },
  mandapa: { color: "#ffc27a", intensity: 22, distance: 20, at: [0, 3.8, 12] },
  gate: { color: "#ffc27a", intensity: 14, distance: 14, at: [GATE.x, 2.8, GATE.z - 1.4] },
} as const;

export interface TempleHandle {
  dispose(): void;
}

interface DebugApi {
  state(): Record<string, unknown>;
  net(): Record<string, unknown>;
  walkTo(x: number, z: number): boolean;
  screenPoint(x: number, y: number, z: number): { x: number; y: number };
  setTimeScale(n: number): void;
  setClock(ms: number | null): void;
  setIdleTimeout(ms: number): void;
  sitOn(mat: number): void;
}

declare global {
  interface Window {
    __sannidhi?: DebugApi;
  }
}

/** The scene clock for day and night: real time, or `?ist=HH:MM` for review (spec 02). */
function makeClock(params: URLSearchParams): { now(): number; override: number | null } {
  const ist = params.get("ist");
  const start = Date.now();
  const clock = { override: null as number | null, now: () => Date.now() };
  if (ist && /^\d{1,2}:\d{2}$/.test(ist)) {
    const base = istTimeOnDay(start, ist.padStart(5, "0"));
    clock.now = () => clock.override ?? base + (Date.now() - start);
  } else {
    clock.now = () => clock.override ?? Date.now();
  }
  return clock;
}

function blobTexture(): CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** The nearest bell within the client's reach, or null (spec 03 § Ring a bell). */
function bellInReach(p: Point): BellId | null {
  let best: BellId | null = null;
  let bestD = BELL_REACH_M;
  for (const id of BELL_IDS) {
    const d = distance(p, BELLS[id]);
    if (d <= bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

const ONBOARDING_KEY = "sannidhi:onboarding-v1";

/** The onboarding hints completed on this device (spec 07 § Onboarding, spec 09 storage keys). */
function readOnboarding(): string[] {
  try {
    const v: unknown = JSON.parse(localStore.getItem(ONBOARDING_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeOnboarding(hint: string): void {
  const done = readOnboarding();
  if (!done.includes(hint)) localStore.setItem(ONBOARDING_KEY, JSON.stringify([...done, hint]));
}

/** Where a bow is offered: the courtyard, the mandapa, and before the Ganesha shrine (spec 03). */
function canBowAt(p: Point): boolean {
  return (
    inShape(COURTYARD, p.x, p.z) || inMandapa(p.x, p.z) || distance(p, GANESHA) <= GANESHA_BOW_M
  );
}

export async function startTemple(host: HTMLElement): Promise<TempleHandle> {
  const params = new URLSearchParams(window.location.search);
  const settings = new SettingsStore(localStore);
  const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = (): boolean => settings.get().reducedMotion ?? systemReduced.matches;
  const clock = makeClock(params);

  let autoTier: Tier = chooseTier(readDeviceInfo());
  const currentTier = (): Tier => {
    const t = settings.get().tier;
    return t === "auto" ? autoTier : t;
  };
  let tier = currentTier();

  // WebGLRenderer throws if no context can be made; main.ts then shows the unsupported screen.
  const renderer = new WebGLRenderer({
    antialias: tier === "high",
    powerPreference: "high-performance",
  });
  const canvas = renderer.domElement;
  canvas.className = "scene";
  canvas.setAttribute("aria-hidden", "true");

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.2, 1600);
  const sky = new Sky(scene);
  sky.sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sky.sun.shadow.camera, {
    left: -20,
    right: 20,
    top: 20,
    bottom: -20,
    near: 1,
    far: SUN_SHADOW_DISTANCE + 60,
  });

  // Lite mode and Low phones get the lighter scene: 72 trees and Lite models (spec 10, 11).
  const lighter = (): boolean => settings.get().lite || tier === "low";
  const greybox = buildGreybox({
    mode: PRADAKSHINA_MODE,
    trees: lighter() ? LITE_TREES : MAX_TREES,
    treeTier: lighter() ? "lite" : "full",
    textureTier: lighter() ? "lite" : "full",
  });
  scene.add(greybox.group);
  const swings = new BellSwings(greybox.bells, greybox.bellHang);
  const tapWater = new TapWater(greybox.tapWater);
  // The jal spot's plate, tirtha pot and the water in the channel (spec 03).
  const offerings = new Offerings();
  scene.add(offerings.group);
  const models = new SceneModels({
    renderer,
    greybox,
    parent: greybox.group,
    tier: lighter() ? "lite" : "full",
    workers: tier === "low" ? 1 : 2,
    // Upload textures and compile shaders before a model is shown, so it doesn't stall a frame.
    prepare: async (model) => {
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        for (const m of [o.material as Material | Material[]].flat()) {
          const maps = m as Material & { map?: Texture | null; emissiveMap?: Texture | null };
          if (maps.map) renderer.initTexture(maps.map);
          if (maps.emissiveMap) renderer.initTexture(maps.emissiveMap);
        }
      });
      await renderer.compileAsync(model, camera, scene);
    },
    // A model arriving costs a few slow frames; keep them out of the tier measurement.
    onChange: () => {
      sampler.reset();
      skipFrames = 3;
    },
    onPlaced: (meshes) => {
      const shadows = renderer.shadowMap.enabled;
      for (const m of meshes) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
    },
  });
  void models.start();

  const lights = {
    sanctum: new PointLight(LIGHTS.sanctum.color, 0, LIGHTS.sanctum.distance, 2),
    mandapa: new PointLight(LIGHTS.mandapa.color, 0, LIGHTS.mandapa.distance, 2),
    gate: new PointLight(LIGHTS.gate.color, 0, LIGHTS.gate.distance, 2),
  };
  for (const key of ["sanctum", "mandapa", "gate"] as const) {
    const [x, y, z] = LIGHTS[key].at;
    lights[key].position.set(x, y, z);
  }
  scene.add(lights.sanctum, lights.mandapa);

  // --- The visitor ---------------------------------------------------------------------------
  let avatar = new Avatar({ shawl: 0, body: 0 }); // replaced by the server's look on welcome
  scene.add(avatar.root);
  const blobMaterial = new MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    color: 0xffffff,
  });
  const blob = new Mesh(new CircleGeometry(0.3, 20), blobMaterial);
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  const walker = new Walker(SPAWN);
  // Straight behind the visitor, so the first view looks through the middle of the gate.
  const rig = new CameraRig({ yaw: SPAWN.yaw });
  /** The mat the visitor sits on, or −1. Online, only after the server's `sit.ok`. */
  let mat = -1;
  /** The visitor sits on a mat the server hasn't confirmed yet (after a reconnect). */
  let matPending = false;
  /** A mat the server holds for the visitor while they walk to it (after "Sit"), or −1. */
  let pendingMat = -1;
  /** Dev and tests: time runs faster, so the server's speed check would correct every step. */
  let fastForward = false;
  let lastBellAt = Number.NEGATIVE_INFINITY;
  let lastWashAt = Number.NEGATIVE_INFINITY;
  /** Washed the hands this visit (spec 03 § Wash hands): only changes the gate hint. */
  let washed = false;
  /** The gate hint (spec 07 § Onboarding, hint 2) was seen on an earlier visit, or this one. */
  let gateHintDone = readOnboarding().includes("gate");

  const restored = loadView(sessionStore, Date.now());
  if (restored) {
    const seatedMat = restored.me.mat >= 0 ? SEATS[restored.me.mat] : undefined;
    if (seatedMat) {
      mat = restored.me.mat;
      walker.place(seatedMat);
      avatar.setSeated(seatKind(mat) === "bench" ? "bench" : true);
      avatar.sitBlend = 1;
    } else {
      walker.place({ x: restored.me.x, z: restored.me.z, yaw: restored.me.yaw });
    }
    rig.orbit = clampOrbit(restored.camera);
    rig.mode = restored.camera.mode;
  }

  let nav: NavGrid | null = null;
  const getNav = (): NavGrid => (nav ??= new NavGrid(PRADAKSHINA_MODE, { deferred: true }));

  // --- Other visitors ------------------------------------------------------------------------
  const floorY = (x: number, z: number, sitBlend: number): number =>
    groundY(x, z) + MAT_TOP * sitBlend;
  /** Dev and tests: the last events received, with arrival times. */
  const recentEvents: { kind: string; from: string; at: number }[] = [];
  // Created now, connected at the end of start-up (spec 10 § Loading priority: P0). Handlers
  // only run after start(), when everything they use exists.
  const base = realtimeBase();
  const session = new Session({
    base,
    wsBase: socketBase(base),
    store: sessionStore,
    lite: () => settings.get().lite,
    handlers: {
      welcome: (_w, mine) => onWelcome(mine),
      status: (st) => onStatus(st),
      event: (e) => {
        if (import.meta.env.DEV) {
          recentEvents.push({ kind: e.kind, from: e.from, at: Date.now() });
          if (recentEvents.length > 20) recentEvents.shift();
        }
        if (e.kind === "namaste" || e.kind === "pranam" || e.kind === "bell") {
          crowd.play(e.from, e.kind, performance.now(), interpDelay());
          hud.noteRemote(e.kind);
          if (e.kind === "bell" && e.bell) {
            swings.ring(e.bell);
            // Another visitor's bell sounds from where it hangs, a little quieter (spec 06).
            effects.play("bell", { at: greybox.bellHang[e.bell], remote: true });
          }
        } else if (e.kind === "whisper") {
          crowd.play(e.from, "whisper", performance.now(), interpDelay());
        } else if (e.kind === "jal") {
          // Another visitor pours: the water runs out along the channel as the pour reaches it.
          const at = JAL_SPOTS[remoteJalSide(e.from)] ?? JAL_SPOTS[0];
          crowd.play(e.from, "pour", performance.now(), interpDelay(), () => {
            offerings.pour(POUR_OUTFLOW_S);
            if (at) effects.play("pour", { at: { x: at.x, y: 1, z: at.z }, remote: true });
          });
        } else if (e.kind === "bilva" || e.kind === "flower") {
          const kind = e.kind;
          const side = remoteJalSide(e.from);
          crowd.play(e.from, kind, performance.now(), interpDelay(), () =>
            offerings.lay(kind, LAY_RELEASE_S, side),
          );
        } else if (e.kind === "charanamrit") {
          crowd.play(e.from, "charanamrit", performance.now(), interpDelay());
        } else if (e.kind === "wash" && e.tap) {
          const tap = e.tap;
          crowd.play(e.from, "wash", performance.now(), interpDelay(), () => tapWater.run(tap));
        }
      },
      correct: (x, z) => {
        // The server keeps the last place it accepted; go back there.
        stand();
        walker.place({ x, z, yaw: walker.yaw });
      },
      counters: () => presenceChanged(),
      jal: (m) => onJal(m),
    },
  });
  const crowd = new Crowd(session.presence, blobMaterial, floorY);
  scene.add(crowd.group);
  session.presence.onChange = () => presenceChanged();

  // --- HUD, tabs, idle, input ----------------------------------------------------------------
  let looping = false;
  let lastLookAt = -Infinity;
  let timeScale = 1;

  // Sound (spec 06): off until the visitor turns it on; files load only then.
  const mixer = new Mixer(localStore);
  const effects = new Effects(mixer, soundUrls());
  // The background loop by day or night, or this visitor's meditation (spec 06 § Background and
  // meditation). The scene clock follows `?ist=` too, so night can be heard in review.
  const beds = new Beds(mixer, soundUrls(), { now: () => clock.now() });
  const toggleMeditation = (): void => {
    const on = !beds.isMeditating;
    // Meditation is heard, so asking for it turns sound on (this is a tap, so the browser allows it).
    if (on && !mixer.audible) mixer.setOn(true);
    beds.setMeditating(on);
  };
  const listenDir = new Vector3();

  const hud = new Hud(host, settings, {
    sound: () => mixer.toggle(),
    meditate: () => toggleMeditation(),
    context: () => doContext(),
    offer: (kind) => offer(kind),
    leaveQueue: () => cancelJal(),
    darshan: () => toggleDarshan(),
    gesture: (g) => doGesture(g),
    sheet: () => updateLoop(),
    hallsOpened: () => {
      hud.setRooms(session.rooms);
      void session.refreshRooms().then((r) => hud.setRooms(r ?? session.rooms));
    },
    chooseHall: (hall) => {
      stand();
      session.switchHall(hall);
    },
    resume: () => {
      owner.claim();
      idle.poke();
      updateLoop();
    },
    liteAccept: () => {
      settings.update({ lite: true, liteSuggested: true });
      hud.showLiteSuggestion(false);
    },
    liteDismiss: () => {
      settings.update({ liteSuggested: true });
      hud.showLiteSuggestion(false);
    },
  });
  hud.setSound(mixer.audible);
  mixer.onChange(() => {
    hud.setSound(mixer.audible);
    // Turning sound off ends meditation; it doesn't wait silently to start again.
    if (!mixer.settings.on && beds.isMeditating) beds.setMeditating(false);
  });
  hud.setMeditation(beds.isMeditating, beds.canMeditate);
  beds.onChange(() => hud.setMeditation(beds.isMeditating, beds.canMeditate));

  const owner = new RenderOwner({
    channel: openChannel(),
    store: localStore,
    onChange: () => updateLoop(),
  });
  const onStorage = (e: StorageEvent): void => {
    if (e.key === RENDER_OWNER_KEY) owner.storageChanged(e.newValue);
  };
  window.addEventListener("storage", onStorage);
  const onFocus = (): void => {
    if (!owner.isOwner) {
      owner.claim();
      idle.poke();
    }
  };
  window.addEventListener("focus", onFocus);

  const idle = new IdleMonitor({ now: () => performance.now(), onChange: () => updateLoop() });

  const input = new Input(canvas, {
    look: (dx, dy) => {
      lastLookAt = performance.now();
      if (rig.lookBy(dx * LOOK_RAD_PER_PX, dy * LOOK_RAD_PER_PX, mat >= 0, reducedMotion()))
        hud.setDarshan(false);
    },
    zoom: (f) => {
      if (rig.zoomBy(f, mat >= 0, reducedMotion())) hud.setDarshan(false);
    },
    tap: (x, y) => tap(x, y),
    action: (a) => {
      if (a === "context") doContext();
      else if (a === "darshan") toggleDarshan();
      else if (a === "namaste" || a === "pranam") hud.tryGesture(a);
      else if (a === "sound") mixer.toggle();
      else if (!hud.sheetOpen && jalWaiting()) cancelJal();
      else if (!hud.sheetOpen && rig.mode !== "orbit") {
        rig.setMode("orbit", reducedMotion());
        hud.setDarshan(false);
      }
    },
    activity: () => {
      if (idle.activity !== "rest") idle.poke();
      // A socket the server closed for silence (4011) reopens on activity, unless the visitor
      // is away (resting, another tab, fast-forward in tests).
      updatePresence();
    },
  });

  // --- Actions -------------------------------------------------------------------------------
  function stand(): void {
    if (pendingMat >= 0) {
      // Walking somewhere else: let the held mat go.
      pendingMat = -1;
      session.stand();
    }
    if (mat < 0) return;
    mat = -1;
    session.stand();
    avatar.setSeated(false);
    rig.setMode("orbit", reducedMotion());
    hud.setDarshan(false);
    hud.announce("a11y.stood");
  }

  function seat(i: number): void {
    const m = SEATS[i];
    if (!m) return;
    mat = i;
    // Exactly on the seat: a path ends on the nearest grid point, a few cm off, and the server
    // seats visitors only on their seat (spec 05 § Movement rule).
    walker.place({ x: m.x, z: m.z, yaw: walker.yaw });
    walker.face(m.yaw);
    if (seatKind(i) === "bench") {
      // On the lawn the camera stays in the orbit view (spec 03 § Sit on a bench).
      avatar.setSeated("bench");
    } else {
      avatar.setSeated(true);
      rig.setMode("darshan", reducedMotion());
      hud.setDarshan(true);
    }
    hud.announce(seatKind(i) === "bench" ? "a11y.seated.bench" : "a11y.seated");
  }

  /** A tapped seat: walk to it, then ask for it (spec 03 § Sit on a mat). Alone, it is free. */
  function sitOn(i: number): void {
    const m = SEATS[i];
    if (!m) return;
    walkTo(m.x, m.z, () => {
      if (!session.online) {
        seat(i);
        return;
      }
      void session.sit(i).then((granted) => {
        // Still where the mat is? (The visitor may have walked on meanwhile.)
        if (distance(walker, m) > SEAT_REACH_M || mat >= 0) return;
        // Refused while connected: someone has it. A dropped connection is not "taken".
        if (granted === null) {
          if (session.online) hud.announce(takenKey(i));
        } else seat(i);
      });
    });
  }

  /** "Sit": the server holds the nearest free mat, then the visitor walks to it and sits. */
  function sitNearest(): void {
    if (!session.online) {
      const i = nearestFreeSeat(walker);
      if (i >= 0) sitOn(i);
      return;
    }
    void session.sit().then((granted) => {
      const m = granted === null ? undefined : SEATS[granted];
      if (granted === null || !m) {
        if (session.online)
          hud.announce(inMandapa(walker.x, walker.z) ? "mat.taken" : "bench.taken");
        return;
      }
      const going = walkTo(m.x, m.z, () => {
        if (pendingMat !== granted) return;
        pendingMat = -1;
        seat(granted);
      });
      if (going) pendingMat = granted;
      else session.stand();
    });
  }

  /**
   * The seat "Sit" gives, as the server picks it: the nearest mat nobody else holds inside the
   * mandapa, else the nearest free bench seat within BENCH_SIT_NEAR_M, else −1.
   */
  function nearestFreeSeat(p: Point): number {
    const held = session.presence.heldMats();
    const inHall = inMandapa(p.x, p.z);
    const first = inHall ? 0 : MAT_COUNT;
    const end = inHall ? MATS.length : SEATS.length;
    let best = -1;
    for (let i = first; i < end; i++) {
      const m = SEATS[i];
      if (!m || held.has(i)) continue;
      if (!inHall && distance(m, p) > BENCH_SIT_NEAR_M) continue;
      const b = SEATS[best];
      if (!b || distance(m, p) < distance(b, p)) best = i;
    }
    return best;
  }

  /** What to say when seat `i` is refused: a mat is taken, or a bench has no room. */
  function takenKey(i: number): "mat.taken" | "bench.taken" {
    return seatKind(i) === "bench" ? "bench.taken" : "mat.taken";
  }

  /** The nearest free seat on the bench tapped at `p`, if `p` is on (or just by) a bench. */
  function benchSeatAt(p: Point): number {
    const k = BENCHES.findIndex(
      (b) =>
        Math.abs(p.x - b.x) <= BENCH_HALF_LENGTH + 0.2 &&
        Math.abs(p.z - b.z) <= BENCH_HALF_DEPTH + 0.3,
    );
    if (k < 0) return -1;
    const held = session.presence.heldMats();
    let best = -1;
    for (const i of [MAT_COUNT + 2 * k, MAT_COUNT + 2 * k + 1]) {
      const m = SEATS[i];
      const b = SEATS[best];
      if (m && !held.has(i) && (!b || distance(m, p) < distance(b, p))) best = i;
    }
    return best;
  }

  function contextAction(): ContextAction | null {
    if (mat >= 0) return "stand";
    if (rig.mode === "shringa") return "shringa-back";
    if (bellInReach(walker)) return "bell";
    if (nearTrough(walker)) return "wash";
    if (earInReach(walker)) return "whisper";
    if (distance(walker, SHRINGA_SPOT) <= SHRINGA_REACH_M) return "shringa";
    if (charanamritOffered(performance.now())) return "charanamrit";
    if (jal.step === "idle" && avatar.playing === null && jalDistance(walker) <= JAL_NEAR_M)
      return "offer";
    if (inMandapa(walker.x, walker.z)) return "sit";
    if (nearestFreeSeat(walker) >= 0) return "sit";
    return null;
  }

  /** The nearer of Nandi's ear spots, if the visitor is within reach of it (spec 03). */
  function earInReach(p: Point): Spot | null {
    let best: Spot | null = null;
    for (const s of NANDI_EAR_SPOTS) {
      if (distance(p, s) <= NANDI_EAR_REACH_M && (!best || distance(p, s) < distance(p, best)))
        best = s;
    }
    return best;
  }

  function doContext(): void {
    const action = contextAction();
    if (action === "stand") stand();
    else if (action === "bell") {
      const bell = bellInReach(walker);
      if (bell) ringBell(bell);
    } else if (action === "wash") {
      goWash(null);
    } else if (action === "sit") {
      sitNearest();
    } else if (action === "whisper") {
      goWhisper();
    } else if (action === "shringa") {
      goShringa();
    } else if (action === "shringa-back") {
      rig.setMode("orbit", reducedMotion());
    } else if (action === "offer") {
      offer("water");
    } else if (action === "charanamrit") {
      goCharanamrit();
    }
  }

  // --- The jal spot (spec 03 § Offer water, bel patra or a flower, § Receive charanamrit) --------

  /** Where the visitor's offering stands: asking, queued, walking to the spot, or offering. */
  type JalStep =
    | { step: "idle" }
    | { step: "asking"; kind: JalKind; req: number }
    | { step: "queued"; kind: JalKind; req: number }
    | { step: "going"; kind: JalKind; req: number | null }
    | { step: "picking"; kind: JalKind; req: number | null; endsAt: number }
    | { step: "placing"; kind: JalKind; req: number | null }
    | { step: "turning"; kind: JalKind; req: number | null }
    | { step: "offering"; kind: JalKind; req: number | null; endsAt: number };
  /** Which side's bench, spot and plate this offering uses (0 north, 1 south). */
  let jalSide = 0;
  let jal: JalStep = { step: "idle" };
  /** Server ms by which this visitor's turn must be done (from `jal.turn`); null offline. */
  let jalUntil: number | null = null;
  /** performance.now() of the last `jal.request`: one a second at most, and a reply is awaited. */
  let jalAskedAt = Number.NEGATIVE_INFINITY;
  /** performance.now() of this visitor's last offering, for the cooldown and charanamrit. */
  let offeredAt = Number.NEGATIVE_INFINITY;
  let charanamritTaken = false;
  let charanamritAfterTurn = false;
  let charanamritEndsAt: number | null = null;
  /** A short notice ("Your turn", the cooldown) goes after this; null when none is timed. */
  let queueNoticeUntil: number | null = null;

  /** Waiting for the spot or walking to it: moving away or Esc gives it up. */
  function jalWaiting(): boolean {
    return (
      jal.step === "asking" ||
      jal.step === "queued" ||
      jal.step === "going" ||
      jal.step === "picking" ||
      jal.step === "placing"
    );
  }

  function briefNotice(kind: "turn" | "cooldown"): void {
    hud.setQueue({ kind });
    queueNoticeUntil = performance.now() + 4000;
  }

  function offer(kind: JalKind): void {
    if (jal.step !== "idle" || mat >= 0) return;
    if (performance.now() - offeredAt < JAL_COOLDOWN_MS) {
      briefNotice("cooldown");
      return;
    }
    // The server takes one request a second; a quicker one would be dropped as a strike.
    if (performance.now() - jalAskedAt < JAL_ASK_GAP_MS) return;
    // Each side of the door has its own turn: ask for the nearer one.
    jalSide = nearestJalSide(walker);
    // Alone (offline), the spot is free: walk there and offer.
    const req = session.online ? session.jalRequest(kind, JAL_SIDES[jalSide] ?? "n") : null;
    jalUntil = null;
    if (req === null) {
      jal = { step: "going", kind, req: null };
      goToJalSpot();
      return;
    }
    jalAskedAt = performance.now();
    jal = { step: "asking", kind, req };
  }

  function onJal(m: JalQueueMessage | JalTurnMessage | JalNoMessage): void {
    if (m.t === "jal.queue") {
      if (jal.step === "asking" || jal.step === "queued") {
        jal = { step: "queued", kind: jal.kind, req: jal.req };
        // The visitor at the spot is ahead too.
        hud.setQueue({ kind: "ahead", n: m.pos + 1 });
        queueNoticeUntil = null;
      } else if (jal.step === "idle") {
        // A place this tab no longer wants (after a reload): give it up.
        session.jalCancel();
      }
      return;
    }
    if (m.t === "jal.turn") {
      if ((jal.step === "asking" || jal.step === "queued") && jal.req === m.req) {
        jal = { step: "going", kind: jal.kind, req: jal.req };
        jalUntil = m.until;
        briefNotice("turn");
        goToJalSpot();
      } else if (jal.step === "idle") {
        session.jalCancel();
      }
      return;
    }
    if (jal.step === "asking" && jal.req === m.req) {
      jal = { step: "idle" };
      hud.setQueue(null);
      if (m.why === "cooldown") briefNotice("cooldown");
    }
  }

  const remoteHead = new Vector3();
  /** The side (0 north, 1 south) another visitor offers from: the one nearer to them. */
  function remoteJalSide(id: VisitorId): number {
    const head = crowd.headOf(id, remoteHead);
    return head ? nearestJalSide({ x: head.x, z: head.z }) : 0;
  }

  /**
   * Walk to the offering bench on the nearer side, take the lota, a bel patra or a flower from it
   * (a short pause facing the bench), then go on to that side's jal spot or lay spot.
   */
  function goToJalSpot(): void {
    const pick = PICK_SPOTS[jalSide] ?? PICK_SPOTS[0];
    if (!pick) return;
    const atBench = (): void => {
      if (jal.step !== "going") return;
      walker.stop();
      walker.face(pick.yaw);
      jal = {
        step: "picking",
        kind: jal.kind,
        req: jal.req,
        endsAt: performance.now() + JAL_PICK_S * 1000,
      };
    };
    if (distance(walker, pick) <= 0.3) atBench();
    else if (!walkTo(pick.x, pick.z, atBench)) cancelJal();
  }

  /** From the bench to the spot where the offering is made. */
  function goFromBench(): void {
    if (jal.step !== "picking") return;
    jal = { step: "placing", kind: jal.kind, req: jal.req };
    const water = jal.kind === "water";
    const spot = (water ? JAL_SPOTS : LAY_SPOTS)[jalSide] ?? JAL_SPOTS[0];
    const plate = OFFERING_PLATES[jalSide] ?? OFFERING_PLATES[0];
    const target = JAL_SPOTS[jalSide] ?? JAL_SPOTS[0];
    if (!spot || !plate || !target) return;
    const arrive = (): void => {
      if (jal.step !== "placing") return;
      walker.stop();
      // Water is poured towards the linga; a leaf or flower is laid on the plate, from close by.
      walker.face(jal.kind === "water" ? target.yaw : yawTowards(walker, plate));
      jal = { step: "turning", kind: jal.kind, req: jal.req };
    };
    if (distance(walker, spot) <= 0.3) arrive();
    else if (!walkTo(spot.x, spot.z, arrive)) cancelJal();
  }

  /** Called each frame: start the offering once turned, finish it when the gesture ends. */
  function updateJal(now: number): void {
    // No answer to a request (it was lost): let the buttons come back.
    if (jal.step === "asking" && now - jalAskedAt > JAL_ASK_TIMEOUT_MS) {
      jal = { step: "idle" };
    }
    // The turn ran out on the server before the offering began: give it up quietly.
    const late = jalUntil !== null && session.serverNow() > jalUntil;
    if (
      late &&
      (jal.step === "going" ||
        jal.step === "picking" ||
        jal.step === "placing" ||
        jal.step === "turning")
    ) {
      jal = { step: "idle" };
      jalUntil = null;
    }
    if (jal.step === "picking" && now >= jal.endsAt && !walker.turning) goFromBench();
    if (jal.step === "turning" && !walker.turning) {
      const anim = jal.kind === "water" ? "pour" : jal.kind;
      avatar.play(anim);
      if (jal.kind === "water") {
        offerings.pour(POUR_OUTFLOW_S);
        effects.play("pour");
      } else {
        offerings.lay(jal.kind, LAY_RELEASE_S, jalSide);
      }
      jal = {
        step: "offering",
        kind: jal.kind,
        req: jal.req,
        endsAt: now + GESTURE_S[anim] * 1000,
      };
    } else if (jal.step === "offering" && now >= jal.endsAt) {
      if (jal.req !== null) session.jalDone(jal.req);
      // Done in time (or alone): the cooldown starts and charanamrit is offered, as on the server.
      if (!late) {
        offeredAt = now;
        charanamritTaken = false;
      }
      jalUntil = null;
      hud.announce(
        jal.kind === "water" ? "a11y.jal" : jal.kind === "bilva" ? "a11y.bilva" : "a11y.flower",
      );
      jal = { step: "idle" };
    }
    if (queueNoticeUntil !== null && now >= queueNoticeUntil) {
      queueNoticeUntil = null;
      hud.setQueue(null);
    }
    if (charanamritAfterTurn && !walker.turning) {
      charanamritAfterTurn = false;
      avatar.play("charanamrit");
      session.gesture("charanamrit");
      charanamritTaken = true;
      charanamritEndsAt = now + CHARANAMRIT_S * 1000;
    }
    if (charanamritEndsAt !== null && now >= charanamritEndsAt) {
      charanamritEndsAt = null;
      hud.announce("a11y.charanamrit");
    }
  }

  /** Leave the queue or the turn (moving away, Esc, "Leave queue"). */
  function cancelJal(): void {
    if (jal.step === "idle" || jal.step === "turning" || jal.step === "offering") return;
    if (jal.req !== null) session.jalCancel();
    jal = { step: "idle" };
    queueNoticeUntil = null;
    hud.setQueue(null);
  }

  /** "Receive charanamrit" is offered for a while after one's own offering, once, near the spot. */
  function charanamritOffered(now: number): boolean {
    return (
      mat < 0 &&
      jal.step === "idle" &&
      !charanamritTaken &&
      !charanamritAfterTurn &&
      now - offeredAt <= CHARANAMRIT_WINDOW_MS &&
      jalDistance(walker) <= JAL_NEAR_M
    );
  }

  function goCharanamrit(): void {
    // The pot on the visitor's own side, so nobody crosses the Nandi axis for it.
    const i = walker.x >= 0 ? 0 : 1;
    const pot = TIRTHA_POTS[i] ?? TIRTHA_POTS[0];
    const spot = CHARANAMRIT_SPOTS[i] ?? CHARANAMRIT_SPOTS[0];
    if (!pot || !spot) return;
    const start = (): void => {
      walker.stop();
      walker.face(yawTowards(walker, pot));
      charanamritAfterTurn = true;
    };
    // Received only at the pot: if there's no way there, nothing happens.
    if (distance(walker, spot) <= 0.3) start();
    else walkTo(spot.x, spot.z, start);
  }

  /** A whisper waiting for the avatar to finish turning towards Nandi's head. */
  let whisperAfterTurn = false;
  /** When the whisper ends, so its (past-tense) announcement comes then; null when none. */
  let whisperEndsAt: number | null = null;

  /**
   * Whisper to Nandi (spec 03 § Whisper to Nandi): step up to the nearer ear spot, turn to his
   * head, then lean in. Nothing is typed or heard.
   */
  function goWhisper(): void {
    if (avatar.playing === "whisper" || whisperAfterTurn) return;
    const spot = earInReach(walker);
    if (!spot) return;
    const start = (): void => {
      walker.stop();
      walker.face(yawTowards(walker, NANDI_HEAD));
      whisperAfterTurn = true;
    };
    if (distance(walker, spot) <= 0.3 || !walkTo(spot.x, spot.z, start)) start();
  }

  /**
   * Darshan between Nandi's horns (spec 03 § Shringa darshan): step onto the spot behind him,
   * face the sanctum, and look between his horns. Local only.
   */
  function goShringa(): void {
    const open = (): void => {
      walker.stop();
      walker.face(SHRINGA_SPOT.yaw);
      rig.setMode("shringa", reducedMotion());
      hud.setDarshan(false);
      hud.announce("a11y.shringa");
    };
    if (distance(walker, SHRINGA_SPOT) <= 0.3 || !walkTo(SHRINGA_SPOT.x, SHRINGA_SPOT.z, open))
      open();
  }

  /**
   * Wash at `tap`, or at the nearest tap nobody is standing at (spec 03 § Wash hands): walk to
   * its spot first if not there yet.
   */
  function goWash(tap: TapId | null): void {
    if (avatar.playing === "wash") return;
    const chosen = tap ?? freeTap(walker);
    const spot = TAP_SPOTS[chosen];
    if (distance(walker, spot) <= 0.3 || (tap === null && tapInReach(walker) === chosen)) {
      washAt(chosen);
      return;
    }
    walkTo(spot.x, spot.z, () => washAt(chosen));
  }

  /** The nearest tap whose spot nobody else stands at; the nearest tap if all are in use. */
  function freeTap(p: Point): TapId {
    const taken = new Set<TapId>();
    for (const r of session.presence.remotes.values()) {
      const last = r.samples[r.samples.length - 1];
      if (!last) continue;
      for (const id of TAP_IDS) if (distance(last, TAP_SPOTS[id]) < 0.5) taken.add(id);
    }
    const order = [...TAP_IDS].sort(
      (a, b) => distance(p, TAP_SPOTS[a]) - distance(p, TAP_SPOTS[b]),
    );
    return order.find((id) => !taken.has(id)) ?? order[0] ?? nearestTap(p);
  }

  function washAt(tap: TapId): void {
    const now = performance.now();
    if (now - lastWashAt < WASH_COOLDOWN_MS + 100 || mat >= 0) return;
    lastWashAt = now;
    walker.stop();
    walker.face(-Math.PI / 2); // towards the tap, on the trough's back wall (−x)
    avatar.play("wash");
    tapWater.run(tap);
    session.wash(tap);
    hud.announce("a11y.wash");
    washed = true;
  }

  function ringBell(bell: BellId): void {
    const now = performance.now();
    if (now - lastBellAt < BELL_COOLDOWN_MS + 100) return;
    lastBellAt = now;
    walker.stop();
    walker.face(yawTowards(walker, BELLS[bell]));
    avatar.play("bell");
    swings.ring(bell);
    effects.play("bell");
    session.bell(bell);
    hud.announce("a11y.bell");
  }

  /** A bow waiting for the avatar to finish turning towards the shrine. */
  let bowAfterTurn = false;

  function doGesture(g: Gesture): void {
    if (g === "pranam") {
      if (mat >= 0 || !canBowAt(walker)) return;
      walker.stop();
      // Face the nearest shrine first; the bow starts once the turn is done (spec 03 § Pranam).
      walker.face(yawTowards(walker, bowTarget(walker)));
      bowAfterTurn = true;
      return;
    }
    playGesture(g);
  }

  function playGesture(g: Gesture): void {
    avatar.play(g);
    session.gesture(g);
    hud.announce(g === "namaste" ? "a11y.namaste" : "a11y.pranam");
  }

  function toggleDarshan(): void {
    const next = rig.mode === "darshan" ? "orbit" : "darshan";
    rig.setMode(next, reducedMotion());
    hud.setDarshan(next === "darshan");
    if (next === "darshan") hud.announce("a11y.darshan");
  }

  function walkTo(x: number, z: number, onArrive: (() => void) | null = null): boolean {
    stand();
    const path = getNav().findPath(walker, { x, z });
    if (!path) return false;
    walker.follow(path, onArrive);
    if (rig.mode !== "orbit") {
      rig.setMode("orbit", reducedMotion());
      hud.setDarshan(false);
    }
    return true;
  }

  /** The visitor's pose on the wire (spec 04 `Pose`). */
  function currentPose(): Pose {
    if (mat >= 0 && avatar.sitBlend > 0.98 && !matPending) return "sit";
    if (avatar.playing === "pranam") return "pranam";
    // Offering at the jal spot, during this visitor's turn (spec 05: `offer` only then).
    if (jal.step === "offering" && jal.req !== null) return "offer";
    return walker.speed > 0.05 ? "walk" : "stand";
  }

  let nameTag: { id: string; until: number; label: string } | null = null;
  /** The canvas rectangle, refreshed on resize, so the name label needs no layout read per frame. */
  let canvasRect = canvas.getBoundingClientRect();
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  function tap(clientX: number, clientY: number): void {
    // Walking elsewhere gives up a place at the jal spot.
    if (jalWaiting()) cancelJal();
    const r = canvas.getBoundingClientRect();
    // A person first: their name shows for a moment.
    const who = crowd.pick(clientX, clientY, camera, r);
    if (who) {
      const visitor = session.presence.remotes.get(who)?.visitor;
      if (visitor) {
        nameTag = {
          id: who,
          until: performance.now() + NAME_TAG_MS,
          label: nameLabel(visitor.name, currentLang()),
        };
      }
      return;
    }
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const onBell = raycaster.intersectObject(greybox.bells, false)[0];
    const bell = onBell?.instanceId !== undefined ? BELL_IDS[onBell.instanceId] : undefined;
    if (bell && distance(walker, BELLS[bell]) <= BELL_REACH_M) {
      ringBell(bell);
      return;
    }
    // A bell out of reach: walk towards it; if no path ends right under it, walk where the tap
    // meets the ground, as on any other tap.
    if (bell && walkTo(BELLS[bell].x, BELLS[bell].z, () => ringBell(bell))) return;
    // The washing trough: wash at the tap nearest where it was tapped.
    const onTrough = raycaster.intersectObject(greybox.troughPick, false)[0];
    if (onTrough) {
      goWash(nearestTap({ x: onTrough.point.x, z: onTrough.point.z }));
      return;
    }
    const onMat = raycaster.intersectObject(greybox.mats, false)[0];
    if (onMat?.instanceId !== undefined) {
      if (onMat.instanceId !== mat) sitOn(onMat.instanceId);
      return;
    }
    const hit = raycaster.intersectObject(greybox.tapMesh, false)[0];
    // A tapped bench: sit on its nearest free seat (spec 03 § Sit on a bench).
    const onBench = hit && mat < 0 ? benchSeatAt({ x: hit.point.x, z: hit.point.z }) : -1;
    if (onBench >= 0) {
      sitOn(onBench);
      return;
    }
    if (hit) walkTo(hit.point.x, hit.point.z);
  }

  // --- Presence ------------------------------------------------------------------------------

  function setLook(v: Visitor): void {
    if (v.shawl === lookOf.shawl && v.body === lookOf.body) return;
    const next = new Avatar({ shawl: v.shawl, body: v.body });
    next.sitBlend = avatar.sitBlend;
    next.setSeated(mat < 0 ? false : seatKind(mat) === "bench" ? "bench" : true);
    scene.remove(avatar.root);
    avatar.dispose();
    avatar = next;
    lookOf.shawl = v.shawl;
    lookOf.body = v.body;
    scene.add(avatar.root);
    applyQuality();
  }
  const lookOf = { shawl: 0, body: 0 };

  function presenceChanged(): void {
    const s = session;
    crowd.sync();
    const others = [...s.presence.remotes.values()].map((r) => r.visitor);
    const hall = s.hall;
    hud.setHall(
      hall && s.online ? { id: hall, number: Number(hall.slice(5)) } : null,
      others.length + 1,
    );
    hud.setWho({ me: s.you, others, today: s.today });
  }

  function onWelcome(mine: StateTuple | undefined): void {
    const s = session;
    if (s.you) setLook(s.you);
    presenceChanged();
    // Still seated from before (a reload, or a resume that didn't hold the mat)? Tell the server
    // where the visitor is, standing, then ask for the mat again; sit only once it agrees.
    const held = mine?.[5] ?? -1;
    // The server still holds a mat the visitor has left (a `stand` lost with the connection).
    if (held >= 0 && mat < 0 && pendingMat < 0) s.stand();
    if (mat >= 0 && held !== mat) {
      const wanted = mat;
      matPending = true;
      s.sendPoseNow(walker.x, walker.z, walker.yaw, "stand");
      void s.sit(wanted).then((granted) => {
        if (mat !== wanted) return;
        matPending = false;
        if (granted === null) {
          stand();
          // Refused while connected means someone else has it; offline, say nothing.
          if (s.online) hud.announce(takenKey(wanted));
        } else {
          s.sendPoseNow(walker.x, walker.z, walker.yaw, "sit");
        }
      });
    }
    checkpoint();
  }

  function onStatus(status: NetStatus): void {
    hud.setConnection(status);
    if (status === "hall-full") hud.openHalls();
    // Alone until the next welcome, except during a short reconnect.
    if (status !== "online" && status !== "reconnecting") session.presence.clear();
    presenceChanged();
  }

  // --- Quality: tier, Lite, shadows, lights --------------------------------------------------
  function applyQuality(): void {
    tier = currentTier();
    renderer.setPixelRatio(pixelRatio(tier, window.devicePixelRatio));
    resize();
    const lite = settings.get().lite;
    models.setTier(lighter() ? "lite" : "full");
    greybox.setTrees(lighter() ? LITE_TREES : MAX_TREES, lighter() ? "lite" : "full");
    const shadows = tier === "high" && !lite;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      sky.sun.castShadow = shadows;
      for (const m of [...greybox.shadowCasters, ...models.meshes()]) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
      for (const m of greybox.shadowReceivers) m.receiveShadow = shadows;
      scene.traverse((o) => {
        const mats = (o as Mesh).material as Material | Material[] | undefined;
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) m.needsUpdate = true;
      });
    }
    avatar.mesh.castShadow = shadows;
    blob.visible = !shadows;
    crowd.blobShadows = !shadows;
    if (tier === "low") lights.gate.removeFromParent();
    else if (!lights.gate.parent) scene.add(lights.gate);
    // Shaders recompile after a change; don't let that hitch count against the new tier.
    sampler.reset();
    skipFrames = 3;
  }

  const sampler = new FrameSampler();
  let skipFrames = 0;
  function adapt(fps: number): void {
    const s = settings.get();
    const d = decide({
      tier,
      auto: s.tier === "auto",
      fps,
      lite: s.lite,
      liteSuggested: s.liteSuggested,
    });
    if (d.tier) {
      autoTier = d.tier;
      applyQuality();
    }
    if (d.suggestLite) hud.showLiteSuggestion(true);
  }

  settings.subscribe((_s, changed) => {
    if (changed.has("lite") || changed.has("tier")) applyQuality();
    // The delta rate is chosen when the socket opens (`lite=1`), so reopen it.
    if (changed.has("lite")) session.reconnect();
  });
  const interpDelay = (): number => (settings.get().lite ? LITE_INTERP_DELAY_MS : INTERP_DELAY_MS);

  // --- Frame loop ------------------------------------------------------------------------------
  let last = performance.now();
  let lastDraw = 0;
  let lastSky = -Infinity;
  let lastCheckpoint = 0;
  let pose: CameraPose | null = null;
  // Reused every frame (spec 10 § Frame loop hygiene).
  const head = new Vector3();
  const tagAt = new Vector3();
  const moveInput: MoveInput = { x: 0, z: 0 };
  const perf = params.has("perf") ? new PerfOverlay(host, renderer, () => tier) : null;

  function simulate(dt: number, now: number): void {
    const ax = input.axes();
    let move: MoveInput | null = null;
    if (ax.forward !== 0 || ax.right !== 0) {
      stand();
      if (jalWaiting()) cancelJal();
      if (rig.mode !== "orbit") {
        rig.setMode("orbit", reducedMotion());
        hud.setDarshan(false);
      }
      const camYaw = pose
        ? Math.atan2(pose.look.x - pose.eye.x, pose.look.z - pose.eye.z)
        : walker.yaw;
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      // The camera's right-hand side is (−fz, fx) with +y up.
      moveInput.x = fx * ax.forward - fz * ax.right;
      moveInput.z = fz * ax.forward + fx * ax.right;
      move = moveInput;
    }
    // Stay put while sitting down, standing up or bowing.
    walker.hold =
      !avatar.standing ||
      avatar.playing === "pranam" ||
      avatar.playing === "wash" ||
      avatar.playing === "whisper" ||
      avatar.playing === "pour" ||
      avatar.playing === "bilva" ||
      avatar.playing === "flower" ||
      avatar.playing === "charanamrit";
    walker.update(dt, mat < 0 && avatar.standing ? move : null);
    if (
      walker.walkingPath &&
      rig.mode === "orbit" &&
      now - lastLookAt > FOLLOW_AFTER_LOOK_MS &&
      !reducedMotion()
    ) {
      rig.follow(walker.yaw, dt);
    }

    const floor = floorY(walker.x, walker.z, avatar.sitBlend);
    avatar.root.position.set(walker.x, floor, walker.z);
    avatar.root.rotation.y = walker.yaw;
    avatar.update(dt, walker.speed, walker.travelled);
    blob.position.set(walker.x, groundY(walker.x, walker.z) + 0.03, walker.z);

    head.set(
      walker.x,
      floor + HEAD_STANDING + (HEAD_SEATED - HEAD_STANDING) * avatar.sitBlend,
      walker.z,
    );
    pose = rig.update(dt, head, walker, mat >= 0);
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
    camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
    camera.getWorldDirection(listenDir);
    mixer.setListener(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      listenDir.x,
      listenDir.y,
      listenDir.z,
    );
    // Between Nandi's horns the camera is just above and ahead of the visitor's figure: hide it.
    avatar.root.visible = rig.mode !== "shringa" && camera.position.distanceTo(head) > 0.7;
    sky.follow(camera.position, avatar.root.position);

    session.sendPose(walker.x, walker.z, walker.yaw, currentPose());
    crowd.update(dt, session.serverNow(), camera.position, now, interpDelay());
    if (bowAfterTurn && !walker.turning) {
      bowAfterTurn = false;
      playGesture("pranam");
    }
    if (whisperAfterTurn && !walker.turning) {
      whisperAfterTurn = false;
      avatar.play("whisper");
      session.gesture("whisper");
      whisperEndsAt = now + WHISPER_S * 1000;
    }
    if (whisperEndsAt !== null && now >= whisperEndsAt) {
      whisperEndsAt = null;
      hud.announce("a11y.whisper");
    }
    swings.update(dt, reducedMotion());
    tapWater.update(dt);
    greybox.kundWater.update(dt, reducedMotion());
    greybox.dhvaja.update(dt, reducedMotion());
    offerings.update(dt);
    updateJal(now);
    updateGateHint();
    updateNameTag(now);

    if (now - lastSky > SKY_UPDATE_MS) {
      lastSky = now;
      const blend = phaseBlend(clock.now());
      const key = `${blend.from}>${blend.to}:${blend.t.toFixed(3)}`;
      if (key !== lastBlend) {
        lastBlend = key;
        applySky(blendLook(blend));
      }
    }

    hud.setContext(contextAction());
    hud.setPranamAvailable(mat < 0 && !bowAfterTurn && canBowAt(walker));
    if (now - lastCheckpoint > CHECKPOINT_MS) checkpoint(now);
  }

  /**
   * The gate hint on a first visit (spec 07 § Onboarding, hint 2): shown on the approach near the
   * gate, with the reminder to wash if the visitor hasn't; done once they walk through the gate.
   */
  function updateGateHint(): void {
    if (gateHintDone) return;
    if (walker.z < GATE.z - 1) {
      gateHintDone = true;
      writeOnboarding("gate");
      hud.showHint(null);
      return;
    }
    const near = Math.abs(walker.x) < 4 && walker.z >= GATE.z && walker.z < GATE.z + 3.5;
    hud.showHint(near ? (washed ? "hint.gate" : "hint.gate_wash") : null);
  }

  function updateNameTag(now: number): void {
    const tag = nameTag;
    const r = tag && now < tag.until ? session.presence.remotes.get(tag.id) : undefined;
    const at = r && tag ? crowd.headOf(tag.id, tagAt) : null;
    if (!r || !at) {
      if (tag) hud.showName(null);
      nameTag = null;
      return;
    }
    at.project(camera);
    const rect = canvasRect;
    hud.showName(
      tag?.label ?? "",
      rect.left + ((at.x + 1) / 2) * rect.width,
      rect.top + ((1 - at.y) / 2) * rect.height,
    );
  }

  /** The last phase blend applied; the sky is only rewritten when it changes. */
  let lastBlend = "";
  function applySky(look: ReturnType<typeof blendLook>): void {
    sky.apply(look);
    greybox.lampMaterial.color.setScalar(0.35 + 0.65 * look.lamps);
    greybox.glowMaterial.opacity = 0.9 * look.lamps;
    lights.sanctum.intensity = LIGHTS.sanctum.intensity * look.sanctum;
    lights.mandapa.intensity = LIGHTS.mandapa.intensity * look.mandapa;
    lights.gate.intensity = LIGHTS.gate.intensity * look.gate;
  }

  function checkpoint(now = performance.now()): void {
    lastCheckpoint = now;
    saveView(sessionStore, {
      at: Date.now(),
      camera: { mode: rig.mode === "shringa" ? "orbit" : rig.mode, ...rig.orbit },
      me: { x: walker.x, z: walker.z, yaw: walker.yaw, mat },
      ...(session.hall ? { hall: session.hall } : {}),
      ...(session.instance ? { instance: session.instance } : {}),
    });
  }

  let lastSim = performance.now();
  function frame(now: number): void {
    const frameMs = now - last;
    last = now;
    if (skipFrames > 0) skipFrames--;
    else if (idle.activity === "active") {
      const fps = sampler.add(frameMs);
      if (fps !== null) adapt(fps);
    }
    // A little tolerance, so a 60 Hz display doesn't wobble between 12 and 15 fps.
    if (idle.activity === "calm" && now - lastDraw < 1000 / CALM_FPS - 4) return;
    const dt = Math.min(0.1, (now - lastSim) / 1000) * timeScale;
    lastSim = now;
    simulate(dt, now);
    renderer.render(scene, camera);
    lastDraw = now;
    perf?.frame(frameMs);
  }

  // --- Presence follows the frame loop (spec 10 § Background, tabs and idle) -----------------
  let hiddenTimer: number | null = null;
  function updatePresence(): void {
    const away = !owner.isOwner || idle.activity === "rest" || fastForward;
    if (away) {
      // Resting, or another tab is the visitor's: their place is held for the resume window.
      session.pause();
    } else if (document.hidden) {
      hiddenTimer ??= window.setTimeout(() => {
        hiddenTimer = null;
        if (document.hidden) session.pause();
      }, HIDDEN_KEEP_MS);
    } else {
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      hiddenTimer = null;
      session.wake();
    }
  }

  function updateLoop(): void {
    const visible = !document.hidden;
    const run = visible && owner.isOwner && idle.activity !== "rest";
    hud.setRest(!owner.isOwner ? "other-tab" : idle.activity === "rest" ? "idle" : null);
    input.enabled = run && !hud.sheetOpen;
    updatePresence();
    if (run === looping) return;
    looping = run;
    last = lastSim = performance.now();
    sampler.reset();
    renderer.setAnimationLoop(run ? frame : null);
    if (!run) checkpoint();
  }

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    canvasRect = canvas.getBoundingClientRect();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!looping && !document.hidden) renderer.render(scene, camera);
  }

  const idleTimer = window.setInterval(() => idle.tick(mat >= 0), 1000);
  const onVisibility = (): void => {
    mixer.setHidden(document.hidden);
    if (!document.hidden && !owner.isOwner) onFocus();
    updateLoop();
    if (!document.hidden) session.reconnectNow();
  };
  const onPageHide = (): void => {
    checkpoint();
    session.conn.noteUnload();
  };
  const onOnline = (): void => session.reconnectNow();

  host.prepend(canvas);
  applyQuality();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", onOnline);

  // Compile every shader while the boot screen is still up, then draw the first frame.
  simulate(0, performance.now());
  prebuildAvatarGeometries();
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  if (document.visibilityState === "visible") owner.claim();

  updateLoop();
  // Rest or another tab may have taken over during start-up.
  const forcedHall = import.meta.env.DEV ? params.get("hall") : null;
  void session.start(isHallId(forcedHall) ? forcedHall : null).then(() => updatePresence());

  // Build the navigation grid in ~8 ms slices after the first frame, so input never freezes.
  const buildNav = (): void => {
    if (!getNav().buildSome(8)) navTimer = window.setTimeout(buildNav, 0);
    else sampler.reset();
  };
  let navTimer = window.setTimeout(buildNav, 50);

  const s = settings.get();
  if (!s.lite && !s.liteSuggested && suggestLiteAtStart(readLiteSignals()))
    hud.showLiteSuggestion(true);

  if (import.meta.env.DEV) {
    window.__sannidhi = {
      state: () => ({
        x: walker.x,
        z: walker.z,
        yaw: walker.yaw,
        mat,
        standing: avatar.standing,
        sitBlend: avatar.sitBlend,
        walking: walker.walkingPath,
        gesture: avatar.playing,
        /** What the visitor's position is blocked by; always null unless something is wrong. */
        blocked: blockedAt(walker.x, walker.z),
        inMandapa: inMandapa(walker.x, walker.z),
        camera: {
          mode: rig.mode,
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        activity: idle.activity,
        owner: owner.isOwner,
        looping,
        tier,
        lite: settings.get().lite,
        lights: scene.children.filter((o) => o instanceof PointLight).length,
        drawCalls: renderer.info.render.calls,
        models: models.status(),
      }),
      net: () => {
        const ss = session;
        const remotes = [...ss.presence.remotes.values()].map((r) => {
          const lastSample = r.samples[r.samples.length - 1];
          return {
            id: r.visitor.id,
            name: r.visitor.name,
            x: lastSample?.x,
            z: lastSample?.z,
            pose: lastSample?.pose,
            mat: lastSample?.mat,
          };
        });
        return {
          status: ss.conn.status,
          hall: ss.hall,
          instance: ss.instance,
          you: ss.you,
          remotes,
          gestures: crowdGestures(),
          events: recentEvents.slice(),
        };
      },
      walkTo: (x, z) => walkTo(x, z),
      screenPoint: (x, y, z) => {
        const v = new Vector3(x, y, z).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      setTimeScale: (n) => {
        timeScale = n;
        // Faster than walking pace is offline; back at 1 the visitor resumes where they are.
        fastForward = n !== 1;
        updatePresence();
      },
      setClock: (ms) => {
        clock.override = ms;
        lastSky = -Infinity;
      },
      setIdleTimeout: (ms) => {
        idle.timeoutMs = ms;
      },
      sitOn: (i) => sitOn(i),
    };
  }

  /** For tests: which remote avatars are playing a gesture now. */
  function crowdGestures(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of session.presence.remotes.keys()) {
      const g = (crowd as unknown as { members: Map<string, { avatar: Avatar }> }).members.get(id)
        ?.avatar.playing;
      if (g) out[id] = g;
    }
    return out;
  }

  // The boot screen stays up while the first-view models arrive, but not for long (spec 01).
  await Promise.race([
    models.firstView,
    new Promise<void>((resolve) => window.setTimeout(resolve, FIRST_VIEW_WAIT_MS)),
  ]);

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      checkpoint();
      session.dispose();
      window.clearInterval(idleTimer);
      window.clearTimeout(navTimer);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      input.dispose();
      owner.dispose();
      hud.dispose();
      effects.dispose();
      offerings.dispose();
      beds.dispose();
      mixer.dispose();
      models.dispose();
      greybox.dispose();
      sky.dispose();
      avatar.dispose();
      crowd.dispose();
      disposeAvatarCache();
      blob.geometry.dispose();
      blobMaterial.map?.dispose();
      blobMaterial.dispose();
      perf?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
