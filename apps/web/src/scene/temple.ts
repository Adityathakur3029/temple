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
  MATS,
  PRADAKSHINA_MODE,
  SEAT_REACH_M,
  SPAWN,
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
  type Pose,
  type StateTuple,
  type Visitor,
} from "@sannidhi/protocol";
import { currentLang } from "../i18n/lang";
import { realtimeBase, socketBase } from "../net/config";
import type { NetStatus } from "../net/connection";
import { Session } from "../net/session";
import { Hud, type Gesture } from "../ui/hud";
import { decide, FrameSampler, readLiteSignals, suggestLiteAtStart } from "../platform/adapt";
import { CALM_FPS, IdleMonitor } from "../platform/idle";
import { SettingsStore } from "../platform/settings";
import { localStore, sessionStore } from "../platform/storage";
import { openChannel, RENDER_OWNER_KEY, RenderOwner } from "../platform/tabs";
import { chooseTier, pixelRatio, readDeviceInfo, type Tier } from "../platform/tier";
import { loadView, saveView } from "../platform/view";
import { Avatar, HEAD_HEIGHT, disposeAvatarCache, prebuildAvatarGeometries } from "./avatar";
import { BellSwings } from "./bells";
import { CameraRig, clampOrbit, type CameraPose } from "./camera";
import { Crowd } from "./crowd";
import { PLINTH, groundY } from "./ground";
import { buildGreybox, MAX_TREES } from "./greybox";
import { Input } from "./input";
import { FIRST_VIEW_WAIT_MS, SceneModels } from "./models";
import { NavGrid } from "./nav";
import { PerfOverlay } from "./perf";
import { blendLook, Sky, SUN_SHADOW_DISTANCE } from "./sky";
import { Walker, type MoveInput } from "./walker";

/** Lite mode keeps the nearest 72 trees (spec 11). */
export const LITE_TREES = 72;
/** Radians of camera turn per CSS pixel dragged. */
const LOOK_RAD_PER_PX = 0.005;
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
  sanctum: { color: "#ffb45a", intensity: 14, distance: 8, at: [0, PLINTH + 1.6, 1.5] },
  mandapa: { color: "#ffc27a", intensity: 14, distance: 16, at: [0, 3.8, 12] },
  gate: { color: "#ffc27a", intensity: 8, distance: 10, at: [GATE.x, 2.8, GATE.z - 1.4] },
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
  });
  scene.add(greybox.group);
  const swings = new BellSwings(greybox.bells, greybox.bellHang);
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

  const restored = loadView(sessionStore, Date.now());
  if (restored) {
    const seatedMat = restored.me.mat >= 0 ? MATS[restored.me.mat] : undefined;
    if (seatedMat) {
      mat = restored.me.mat;
      walker.place(seatedMat);
      avatar.setSeated(true);
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
          if (e.kind === "bell" && e.bell) swings.ring(e.bell);
        }
      },
      correct: (x, z) => {
        // The server keeps the last place it accepted; go back there.
        stand();
        walker.place({ x, z, yaw: walker.yaw });
      },
      counters: () => presenceChanged(),
    },
  });
  const crowd = new Crowd(session.presence, blobMaterial, floorY);
  scene.add(crowd.group);
  session.presence.onChange = () => presenceChanged();

  // --- HUD, tabs, idle, input ----------------------------------------------------------------
  let looping = false;
  let lastLookAt = -Infinity;
  let timeScale = 1;

  const hud = new Hud(host, settings, {
    context: () => doContext(),
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
      else if (!hud.sheetOpen && rig.mode === "darshan") {
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
    const m = MATS[i];
    if (!m) return;
    mat = i;
    // Exactly on the mat: a path ends on the nearest grid point, a few cm off, and the server
    // seats visitors only on their mat (spec 05 § Movement rule).
    walker.place({ x: m.x, z: m.z, yaw: walker.yaw });
    walker.face(m.yaw);
    avatar.setSeated(true);
    rig.setMode("darshan", reducedMotion());
    hud.setDarshan(true);
    hud.announce("a11y.seated");
  }

  /** A tapped mat: walk to it, then ask for it (spec 03 § Sit on a mat). Alone, it is free. */
  function sitOn(i: number): void {
    const m = MATS[i];
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
          if (session.online) hud.announce("mat.taken");
        } else seat(i);
      });
    });
  }

  /** "Sit": the server holds the nearest free mat, then the visitor walks to it and sits. */
  function sitNearest(): void {
    if (!session.online) {
      const i = nearestFreeMat(walker);
      if (i >= 0) sitOn(i);
      return;
    }
    void session.sit().then((granted) => {
      const m = granted === null ? undefined : MATS[granted];
      if (granted === null || !m) {
        if (session.online) hud.announce("mat.taken");
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

  /** The nearest mat nobody else holds. */
  function nearestFreeMat(p: Point): number {
    const held = session.presence.heldMats();
    let best = -1;
    MATS.forEach((m, i) => {
      if (held.has(i)) return;
      const b = MATS[best];
      if (!b || distance(m, p) < distance(b, p)) best = i;
    });
    return best;
  }

  function contextAction(): "stand" | "bell" | "sit" | null {
    if (mat >= 0) return "stand";
    if (bellInReach(walker)) return "bell";
    if (inMandapa(walker.x, walker.z)) return "sit";
    return null;
  }

  function doContext(): void {
    const action = contextAction();
    if (action === "stand") stand();
    else if (action === "bell") {
      const bell = bellInReach(walker);
      if (bell) ringBell(bell);
    } else if (action === "sit") {
      sitNearest();
    }
  }

  function ringBell(bell: BellId): void {
    const now = performance.now();
    if (now - lastBellAt < BELL_COOLDOWN_MS + 100) return;
    lastBellAt = now;
    walker.stop();
    walker.face(yawTowards(walker, BELLS[bell]));
    avatar.play("bell");
    swings.ring(bell);
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
    if (rig.mode === "darshan") {
      rig.setMode("orbit", reducedMotion());
      hud.setDarshan(false);
    }
    return true;
  }

  /** The visitor's pose on the wire (spec 04 `Pose`). */
  function currentPose(): Pose {
    if (mat >= 0 && avatar.sitBlend > 0.98 && !matPending) return "sit";
    if (avatar.playing === "pranam") return "pranam";
    return walker.speed > 0.05 ? "walk" : "stand";
  }

  let nameTag: { id: string; until: number; label: string } | null = null;
  /** The canvas rectangle, refreshed on resize, so the name label needs no layout read per frame. */
  let canvasRect = canvas.getBoundingClientRect();
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  function tap(clientX: number, clientY: number): void {
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
    const onMat = raycaster.intersectObject(greybox.mats, false)[0];
    if (onMat?.instanceId !== undefined) {
      if (onMat.instanceId !== mat) sitOn(onMat.instanceId);
      return;
    }
    const hit = raycaster.intersectObject(greybox.tapMesh, false)[0];
    if (hit) walkTo(hit.point.x, hit.point.z);
  }

  // --- Presence ------------------------------------------------------------------------------

  function setLook(v: Visitor): void {
    if (v.shawl === lookOf.shawl && v.body === lookOf.body) return;
    const next = new Avatar({ shawl: v.shawl, body: v.body });
    next.sitBlend = avatar.sitBlend;
    next.setSeated(mat >= 0);
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
          if (s.online) hud.announce("mat.taken");
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
      if (rig.mode === "darshan") {
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
    walker.hold = !avatar.standing || avatar.playing === "pranam";
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
    avatar.root.visible = camera.position.distanceTo(head) > 0.7;
    sky.follow(camera.position, avatar.root.position);

    session.sendPose(walker.x, walker.z, walker.yaw, currentPose());
    crowd.update(dt, session.serverNow(), camera.position, now, interpDelay());
    if (bowAfterTurn && !walker.turning) {
      bowAfterTurn = false;
      playGesture("pranam");
    }
    swings.update(dt, reducedMotion());
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
      camera: { mode: rig.mode, ...rig.orbit },
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
