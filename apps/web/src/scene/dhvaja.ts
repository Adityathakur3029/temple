/**
 * The dhvaja on the shikhara (spec 02 § Shrine): a thin brass pole rising from the amalaka just
 * behind the kalasha, a small brass trishul on its tip, and a saffron double-pointed flag flying
 * towards the north so it is seen side-on from the gate path.
 *
 * Our own simple design, not any real temple's flag. The trishul is at the very top, the one
 * sacred symbol here, and only at height (spec 08 § Symbols).
 *
 * The flag ripples in a slow wind with a few lines of vertex shader: the pole edge stays still and
 * the wave grows towards the tips. With reduced motion it hangs still (spec 07 § Accessibility).
 * About 200 triangles in two draws (spec 10).
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Pole foot: on the amalaka's top, behind the kalasha (the shrine model's kalasha is at x = z = 0). */
const POLE_X = 0;
const POLE_Z = -0.85;
const POLE_FOOT = 15.0;
const POLE_TOP = 18.2;
/** The flag's top edge, just under the trishul. */
const FLAG_TOP = 17.8;
const FLAG_HEIGHT = 0.9;
const FLAG_LENGTH = 1.6;
/** Columns along the flag's length, for a smooth wave. */
const COLS = 12;

const SAFFRON = "#e8731c";
const BRASS = "#b08d3c";

export class Dhvaja {
  readonly group = new Group();
  private readonly time = { value: 0 };
  private readonly flagMaterial: MeshLambertMaterial;
  private readonly brassMaterial: MeshLambertMaterial;

  constructor() {
    this.group.name = "dhvaja";

    this.brassMaterial = new MeshLambertMaterial({ color: BRASS });
    const pole = new Mesh(poleAndTrishul(), this.brassMaterial);
    pole.position.set(POLE_X, 0, POLE_Z);
    this.group.add(pole);

    this.flagMaterial = new MeshLambertMaterial({ color: SAFFRON, side: DoubleSide });
    const time = this.time;
    this.flagMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nuniform float uTime;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WAVE_GLSL}`);
    };
    this.flagMaterial.customProgramCacheKey = () => "dhvaja-flag";
    const flag = new Mesh(flagGeometry(), this.flagMaterial);
    flag.position.set(POLE_X + 0.03, FLAG_TOP, POLE_Z);
    flag.frustumCulled = false; // the wave moves vertices outside the flat bounds
    this.group.add(flag);
  }

  update(dt: number, reducedMotion: boolean): void {
    if (!reducedMotion) this.time.value = (this.time.value + dt) % 3600;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) (o as Mesh<BufferGeometry>).geometry.dispose();
    });
    this.flagMaterial.dispose();
    this.brassMaterial.dispose();
  }
}

/** The pole and the trishul on top, in one geometry, with the pole's foot at y = POLE_FOOT. */
function poleAndTrishul(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const len = POLE_TOP - POLE_FOOT;
  parts.push(new CylinderGeometry(0.035, 0.05, len, 8).translate(0, POLE_FOOT + len / 2, 0));
  // A small collar where the trishul is fixed.
  parts.push(new CylinderGeometry(0.07, 0.07, 0.06, 10).translate(0, POLE_TOP, 0));
  // Trishul: a crossbar, a taller centre prong and two outer prongs, facing east (+z).
  const base = POLE_TOP + 0.05;
  parts.push(new BoxGeometry(0.5, 0.05, 0.04).translate(0, base + 0.06, 0));
  parts.push(new BoxGeometry(0.045, 0.55, 0.04).translate(0, base + 0.3, 0));
  parts.push(new CylinderGeometry(0, 0.05, 0.14, 4).translate(0, base + 0.64, 0));
  for (const s of [-1, 1]) {
    parts.push(new BoxGeometry(0.04, 0.34, 0.04).translate(s * 0.23, base + 0.23, 0));
    parts.push(new CylinderGeometry(0, 0.045, 0.12, 4).translate(s * 0.23, base + 0.46, 0));
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * A double-pointed (swallow-tail) flag in its own plane: x along the length (0 at the pole),
 * y down from the top edge (0 to −FLAG_HEIGHT). The fly end is cut in a V.
 */
function flagGeometry(): BufferGeometry {
  const pos: number[] = [];
  const notch = 0.35; // how deep the V cuts back from the tips
  const edge = (u: number): [number, number] => {
    // Top and bottom of the cloth at a point u (0..1) along the length.
    const x = u * FLAG_LENGTH;
    const cut = Math.max(0, x - (FLAG_LENGTH - notch)) / notch; // 0..1 across the V
    const half = FLAG_HEIGHT / 2;
    return [-half + half * cut, -half - half * cut]; // centre line pulls in at the V
  };
  for (let i = 0; i < COLS; i++) {
    const u0 = i / COLS;
    const u1 = (i + 1) / COLS;
    const x0 = u0 * FLAG_LENGTH;
    const x1 = u1 * FLAG_LENGTH;
    // Upper half: from the top edge down to the centre line (or the V's upper side).
    const [a0] = edge(u0);
    const [a1] = edge(u1);
    pos.push(x0, 0, 0, x0, a0, 0, x1, a1, 0, x0, 0, 0, x1, a1, 0, x1, 0, 0);
    // Lower half: from the V's lower side down to the bottom edge.
    const [, b0] = edge(u0);
    const [, b1] = edge(u1);
    const bot = -FLAG_HEIGHT;
    pos.push(x0, b0, 0, x0, bot, 0, x1, bot, 0, x0, b0, 0, x1, bot, 0, x1, b1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Fly towards the north (+x), seen side-on from the gate path.
  return g;
}

/** Wave out of the flag's plane (z), growing from the pole edge to the tips; slight droop. */
const WAVE_GLSL = /* glsl */ `
float flagU = clamp(transformed.x / ${FLAG_LENGTH.toFixed(2)}, 0.0, 1.0);
float flagW = sin(transformed.x * 3.2 - uTime * 3.0) * 0.6
            + sin(transformed.x * 5.1 - uTime * 4.3 + transformed.y * 1.5) * 0.4;
transformed.z += flagW * 0.16 * flagU;
transformed.y -= 0.06 * flagU * flagU;
`;
