/**
 * M0 placeholder: a slowly turning stone-coloured cube, proving the lazy-loaded Three.js
 * bundle and the frame loop. The greybox temple replaces it in M1 (spec 02).
 */
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

/** High tier caps DPR at 2 (spec 10). Device tiers arrive in M1. */
const MAX_PIXEL_RATIO = 2;
const TURN_RAD_PER_S = 0.25;

export function startPlaceholderScene(host: HTMLElement): void {
  const renderer = new WebGLRenderer({ antialias: false });
  const canvas = renderer.domElement;
  canvas.className = "scene";
  canvas.setAttribute("aria-hidden", "true");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));

  const scene = new Scene();
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  scene.background = new Color(bg || "#141d18");

  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.2, 4);
  camera.lookAt(0, 0, 0);

  scene.add(new HemisphereLight("#f2e8d5", "#2f3b33", 1.2));
  const sun = new DirectionalLight("#fff4e0", 1.6);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const cube = new Mesh(
    new BoxGeometry(1.2, 1.2, 1.2),
    new MeshStandardMaterial({ color: "#8c8274", roughness: 0.9 }),
  );
  scene.add(cube);

  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  let looping = false;
  let last = performance.now();

  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // The running loop draws the next frame anyway; only redraw here when it is stopped.
    if (!looping && !document.hidden) renderer.render(scene, camera);
  };

  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    cube.rotation.y += TURN_RAD_PER_S * dt;
    renderer.render(scene, camera);
  };

  // The frame loop runs only while the page is visible and motion is allowed (spec 10).
  const updateLoop = (): void => {
    looping = !document.hidden && !still.matches;
    last = performance.now();
    renderer.setAnimationLoop(looping ? frame : null);
    if (!looping && !document.hidden) renderer.render(scene, camera);
  };

  host.prepend(canvas);
  cube.rotation.x = 0.35;
  resize();
  updateLoop();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", updateLoop);
  still.addEventListener("change", updateLoop);
}
