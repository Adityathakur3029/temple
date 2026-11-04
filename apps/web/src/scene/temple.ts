/**
 * The solo temple (M1, spec 13): the greybox world, the visitor's avatar, orbit and darshan
 * cameras, tap-to-walk and keyboard walking, day and night on IST, device tiers and Lite mode,
 * one rendering tab, idle and calm modes, and view restore.
 * Networking (M2) plugs in where the comments say "M2".
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
} from "three";
import {
  MATS,
  PRADAKSHINA_MODE,
  SPAWN,
  blockedAt,
  distance,
  inMandapa,
  istTimeOnDay,
  phaseBlend,
  type Point,
} from "@sannidhi/protocol";
import { Hud } from "../ui/hud";
import { decide, FrameSampler, readLiteSignals, suggestLiteAtStart } from "../platform/adapt";
import { CALM_FPS, IdleMonitor } from "../platform/idle";
import { SettingsStore } from "../platform/settings";
import { localStore, sessionStore } from "../platform/storage";
import { openChannel, RENDER_OWNER_KEY, RenderOwner } from "../platform/tabs";
import { chooseTier, pixelRatio, readDeviceInfo, type Tier } from "../platform/tier";
import { loadView, saveView } from "../platform/view";
import { Avatar } from "./avatar";
import { CameraRig, clampOrbit, type CameraPose } from "./camera";
import { PLINTH, groundY } from "./ground";
import { buildGreybox, MAX_TREES } from "./greybox";
import { Input } from "./input";
import { NavGrid } from "./nav";
import { PerfOverlay } from "./perf";
import { blendLook, Sky } from "./sky";
import { Walker, type MoveInput } from "./walker";

/** Lite mode keeps the nearest 120 trees (spec 11). */
export const LITE_TREES = 120;
/** Radians of camera turn per CSS pixel dragged. */
const LOOK_RAD_PER_PX = 0.005;
/** Tap-to-walk eases the camera round behind the visitor this long after the last look. */
const FOLLOW_AFTER_LOOK_MS = 2500;
const CHECKPOINT_MS = 2000;
const SKY_UPDATE_MS = 1000;
const HEAD_STANDING = 1.45;
const HEAD_SEATED = 0.85;
const MAT_TOP = 0.025;
const SPAWN_CAMERA_OFFSET = 0.16;

/** Point lights at full strength; at most 4, and 2 on the Low tier (spec 02, spec 10). */
const LIGHTS = {
  sanctum: { color: "#ffb45a", intensity: 14, distance: 8, at: [0, PLINTH + 1.6, 1.5] },
  mandapa: { color: "#ffc27a", intensity: 14, distance: 16, at: [0, 3.8, 12] },
  gate: { color: "#ffc27a", intensity: 8, distance: 10, at: [0, 2.8, 56.6] },
} as const;

export interface TempleHandle {
  dispose(): void;
}

interface DebugApi {
  state(): Record<string, unknown>;
  walkTo(x: number, z: number): boolean;
  screenPoint(x: number, y: number, z: number): { x: number; y: number };
  setTimeScale(n: number): void;
  setClock(ms: number | null): void;
  setIdleTimeout(ms: number): void;
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
    far: 100,
  });

  const greybox = buildGreybox({
    mode: PRADAKSHINA_MODE,
    trees: settings.get().lite ? LITE_TREES : MAX_TREES,
    footwearPairs: 1, // M2: one pair for each visitor present
  });
  scene.add(greybox.group);

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
  const avatar = new Avatar({ shawl: 0, body: 0 }); // M2: assigned by the server
  scene.add(avatar.root);
  const blob = new Mesh(
    new CircleGeometry(0.42, 20),
    new MeshBasicMaterial({
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      color: 0xffffff,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  const walker = new Walker(SPAWN);
  // Slightly off the axis, so the gate bell doesn't hide the shikhara from the first view.
  const rig = new CameraRig({ yaw: SPAWN.yaw + SPAWN_CAMERA_OFFSET });
  /** The mat the visitor sits on, or −1. M2: the server confirms with sit.ok. */
  let mat = -1;

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

  // --- HUD, tabs, idle, input ----------------------------------------------------------------
  let looping = false;
  let lastLookAt = -Infinity;
  let timeScale = 1;

  const hud = new Hud(host, settings, {
    context: () => doContext(),
    darshan: () => toggleDarshan(),
    sheet: () => updateLoop(),
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
      else if (!hud.sheetOpen && rig.mode === "darshan") {
        rig.setMode("orbit", reducedMotion());
        hud.setDarshan(false);
      }
    },
    activity: () => {
      if (idle.activity !== "rest") idle.poke();
    },
  });

  // --- Actions -------------------------------------------------------------------------------
  function stand(): void {
    if (mat < 0) return;
    mat = -1;
    avatar.setSeated(false);
    rig.setMode("orbit", reducedMotion());
    hud.setDarshan(false);
    hud.announce("a11y.stood");
  }

  function sitOn(i: number): void {
    const m = MATS[i];
    if (!m) return;
    // M2: send `sit {req, mat}` and wait for `sit.ok`; solo, every mat is free.
    walkTo(m.x, m.z, () => {
      mat = i;
      walker.face(m.yaw);
      avatar.setSeated(true);
      rig.setMode("darshan", reducedMotion());
      hud.setDarshan(true);
      hud.announce("a11y.seated");
    });
  }

  function nearestMat(p: Point): number {
    let best = 0;
    MATS.forEach((m, i) => {
      if (distance(m, p) < distance(MATS[best] ?? m, p)) best = i;
    });
    return best;
  }

  function doContext(): void {
    if (mat >= 0) stand();
    else if (inMandapa(walker.x, walker.z)) sitOn(nearestMat(walker));
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

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  function tap(clientX: number, clientY: number): void {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const onMat = raycaster.intersectObject(greybox.mats, false)[0];
    if (onMat?.instanceId !== undefined) {
      if (onMat.instanceId !== mat) sitOn(onMat.instanceId);
      return;
    }
    const hit = raycaster.intersectObject(greybox.ground, false)[0];
    if (hit) walkTo(hit.point.x, hit.point.z);
  }

  // --- Quality: tier, Lite, shadows, lights --------------------------------------------------
  function applyQuality(): void {
    tier = currentTier();
    renderer.setPixelRatio(pixelRatio(tier, window.devicePixelRatio));
    resize();
    const lite = settings.get().lite;
    const trees = Math.min(greybox.treesAvailable, lite ? LITE_TREES : MAX_TREES);
    if (greybox.trees.count !== trees) {
      greybox.trees.count = trees;
      // Bounds are cached per count; a stale sphere could cull every tree at once.
      greybox.trees.boundingSphere = null;
    }
    const shadows = tier === "high" && !lite;
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      sky.sun.castShadow = shadows;
      for (const m of greybox.shadowCasters) {
        m.castShadow = shadows;
        m.receiveShadow = shadows;
      }
      scene.traverse((o) => {
        const mats = (o as Mesh).material as Material | Material[] | undefined;
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) m.needsUpdate = true;
      });
    }
    blob.visible = !shadows;
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
  });

  // --- Frame loop ------------------------------------------------------------------------------
  let last = performance.now();
  let lastDraw = 0;
  let lastSky = -Infinity;
  let lastCheckpoint = 0;
  let pose: CameraPose | null = null;
  // Reused every frame (spec 10 § Frame loop hygiene).
  const head = new Vector3();
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
    // Stay put while sitting down or standing up.
    walker.hold = !avatar.standing;
    walker.update(dt, mat < 0 && avatar.standing ? move : null);
    if (
      walker.walkingPath &&
      rig.mode === "orbit" &&
      now - lastLookAt > FOLLOW_AFTER_LOOK_MS &&
      !reducedMotion()
    ) {
      rig.follow(walker.yaw, dt);
    }

    const floor = groundY(walker.x, walker.z) + MAT_TOP * avatar.sitBlend;
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

    if (now - lastSky > SKY_UPDATE_MS) {
      lastSky = now;
      const blend = phaseBlend(clock.now());
      const key = `${blend.from}>${blend.to}:${blend.t.toFixed(3)}`;
      if (key !== lastBlend) {
        lastBlend = key;
        applySky(blendLook(blend));
      }
    }

    hud.setContext(mat >= 0 ? "stand" : inMandapa(walker.x, walker.z) ? "sit" : null);
    if (now - lastCheckpoint > CHECKPOINT_MS) checkpoint(now);
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

  function updateLoop(): void {
    const visible = !document.hidden;
    const run = visible && owner.isOwner && idle.activity !== "rest";
    hud.setRest(!owner.isOwner ? "other-tab" : idle.activity === "rest" ? "idle" : null);
    input.enabled = run && !hud.sheetOpen;
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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!looping && !document.hidden) renderer.render(scene, camera);
  }

  const idleTimer = window.setInterval(() => idle.tick(mat >= 0), 1000);
  const onVisibility = (): void => {
    if (!document.hidden && !owner.isOwner) onFocus();
    updateLoop();
  };
  const onPageHide = (): void => checkpoint();

  host.prepend(canvas);
  applyQuality();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);

  // Compile every shader while the boot screen is still up, then draw the first frame.
  simulate(0, performance.now());
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  if (document.visibilityState === "visible") owner.claim();
  updateLoop();
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
      }),
      walkTo: (x, z) => walkTo(x, z),
      screenPoint: (x, y, z) => {
        const v = new Vector3(x, y, z).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      setTimeScale: (n) => {
        timeScale = n;
      },
      setClock: (ms) => {
        clock.override = ms;
        lastSky = -Infinity;
      },
      setIdleTimeout: (ms) => {
        idle.timeoutMs = ms;
      },
    };
  }

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      checkpoint();
      window.clearInterval(idleTimer);
      window.clearTimeout(navTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      input.dispose();
      owner.dispose();
      hud.dispose();
      greybox.dispose();
      sky.dispose();
      avatar.dispose();
      blob.geometry.dispose();
      blob.material.map?.dispose();
      blob.material.dispose();
      perf?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
