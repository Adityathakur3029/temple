/**
 * Day and night on IST (spec 02 § Light and time): night, dawn, day and dusk looks, blended over
 * the 10 minutes after each phase starts. The sky dome, stars, moon, fog, sun and lamp glow follow.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import type { DayPhase, PhaseBlend } from "@sannidhi/protocol";

interface Look {
  top: string;
  horizon: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunIntensity: number;
  /** Towards the sun (or the moon at night): +x north, +z east. */
  sunDir: readonly [number, number, number];
  /** 0–1: lamp bodies and glow. */
  lamps: number;
  stars: number;
  /** Point-light strengths, 0–1 of their full value. */
  sanctum: number;
  mandapa: number;
  gate: number;
}

export const LOOKS: Readonly<Record<DayPhase, Look>> = {
  night: {
    top: "#060b17",
    horizon: "#1c2741",
    fog: "#151d2f",
    hemiSky: "#46547e",
    hemiGround: "#161616",
    hemi: 0.85,
    sun: "#a9b8de",
    sunIntensity: 0.5,
    sunDir: [0.35, 0.8, -0.5],
    lamps: 1,
    stars: 1,
    sanctum: 1,
    mandapa: 1,
    gate: 1,
  },
  dawn: {
    top: "#6c7fae",
    horizon: "#f1b59b",
    fog: "#d0a394",
    hemiSky: "#f3c9b0",
    hemiGround: "#4a3a33",
    hemi: 0.95,
    sun: "#ffbb8c",
    sunIntensity: 1.2,
    sunDir: [-0.25, 0.3, 1],
    lamps: 0.55,
    stars: 0.12,
    sanctum: 0.85,
    mandapa: 0.35,
    gate: 0.3,
  },
  day: {
    top: "#5b8ec6",
    horizon: "#cadcea",
    fog: "#c4d4df",
    hemiSky: "#e6eef6",
    hemiGround: "#575642",
    hemi: 1.15,
    sun: "#fff2dc",
    sunIntensity: 2.1,
    sunDir: [-0.5, 1, 0.3],
    lamps: 0.25,
    stars: 0,
    sanctum: 0.75,
    mandapa: 0,
    gate: 0,
  },
  dusk: {
    top: "#3c4a79",
    horizon: "#e5905f",
    fog: "#b27b63",
    hemiSky: "#e8a87c",
    hemiGround: "#3a2a2a",
    hemi: 0.85,
    sun: "#ff9b5b",
    sunIntensity: 1.05,
    sunDir: [-0.25, 0.28, -1],
    lamps: 0.85,
    stars: 0.08,
    sanctum: 0.9,
    mandapa: 0.7,
    gate: 0.7,
  },
};

export interface SkyState {
  top: Color;
  horizon: Color;
  fog: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
  sun: Color;
  sunIntensity: number;
  sunDir: Vector3;
  lamps: number;
  stars: number;
  sanctum: number;
  mandapa: number;
  gate: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The look for a point in a phase change. */
export function blendLook(blend: PhaseBlend): SkyState {
  const a = LOOKS[blend.from];
  const b = LOOKS[blend.to];
  const t = Math.min(1, Math.max(0, blend.t));
  const col = (x: string, y: string): Color => new Color(x).lerp(new Color(y), t);
  const dir = new Vector3(...a.sunDir)
    .normalize()
    .lerp(new Vector3(...b.sunDir).normalize(), t)
    .normalize();
  return {
    top: col(a.top, b.top),
    horizon: col(a.horizon, b.horizon),
    fog: col(a.fog, b.fog),
    hemiSky: col(a.hemiSky, b.hemiSky),
    hemiGround: col(a.hemiGround, b.hemiGround),
    hemi: lerp(a.hemi, b.hemi, t),
    sun: col(a.sun, b.sun),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    sunDir: dir,
    lamps: lerp(a.lamps, b.lamps, t),
    stars: lerp(a.stars, b.stars, t),
    sanctum: lerp(a.sanctum, b.sanctum, t),
    mandapa: lerp(a.mandapa, b.mandapa, t),
    gate: lerp(a.gate, b.gate, t),
  };
}

const DOME_RADIUS = 900;
/** How far the sun light sits from the visitor along its ray; the shadow camera reaches 60 m past. */
export const SUN_SHADOW_DISTANCE = 80;
const MOON_DIR = new Vector3(0.35, 0.5, -0.75).normalize();

export class Sky {
  readonly hemi = new HemisphereLight();
  readonly sun = new DirectionalLight();
  readonly fog = new Fog(0x000000, 60, 900);
  private readonly dome: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  private readonly moon: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly domeColors: BufferAttribute;
  private readonly c = new Color();

  constructor(scene: Scene) {
    const dome = new SphereGeometry(DOME_RADIUS, 24, 12);
    this.domeColors = new BufferAttribute(
      new Float32Array(dome.getAttribute("position").count * 3),
      3,
    );
    dome.setAttribute("color", this.domeColors);
    this.dome = new Mesh(
      dome,
      new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
    );
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;

    const starPos: number[] = [];
    let seed = 41;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    while (starPos.length < 600 * 3) {
      const v = new Vector3(rand() * 2 - 1, rand(), rand() * 2 - 1);
      if (v.length() > 1 || v.y < 0.08) continue;
      v.normalize().multiplyScalar(DOME_RADIUS * 0.95);
      starPos.push(v.x, v.y, v.z);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute("position", new Float32BufferAttribute(starPos, 3));
    this.stars = new Points(
      starGeo,
      new PointsMaterial({
        size: 1.6,
        sizeAttenuation: false,
        color: 0xf4f1e6,
        transparent: true,
        fog: false,
        depthWrite: false,
      }),
    );
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;

    this.moon = new Mesh(
      new CircleGeometry(16, 24),
      new MeshBasicMaterial({ color: 0xf2efe4, transparent: true, fog: false, depthWrite: false }),
    );
    this.moon.renderOrder = -1;

    scene.fog = this.fog;
    scene.add(this.dome, this.stars, this.moon, this.hemi, this.sun, this.sun.target);
  }

  apply(s: SkyState): void {
    const pos = this.dome.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / DOME_RADIUS;
      const t = Math.min(1, Math.max(0, (h + 0.02) / 0.55));
      this.c.copy(s.horizon).lerp(s.top, t * t * (3 - 2 * t));
      if (h < -0.02) this.c.copy(s.fog);
      this.domeColors.setXYZ(i, this.c.r, this.c.g, this.c.b);
    }
    this.domeColors.needsUpdate = true;
    this.fog.color.copy(s.fog);
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemi;
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunIntensity;
    this.sunDir.copy(s.sunDir);
    this.stars.material.opacity = s.stars;
    this.stars.visible = s.stars > 0.01;
    this.moon.material.opacity = s.stars;
    this.moon.visible = s.stars > 0.01;
  }

  private readonly sunDir = new Vector3(0, 1, 0);

  /** Keeps the sky round the camera and the sun's light (and shadow box) round the visitor. */
  follow(camera: Vector3, focus: Vector3): void {
    this.dome.position.copy(camera);
    this.stars.position.copy(camera);
    this.moon.position.copy(camera).addScaledVector(MOON_DIR, DOME_RADIUS * 0.9);
    this.moon.lookAt(camera);
    this.sun.target.position.copy(focus);
    // Far enough up the sun's ray that a 20 m tree's top still casts a shadow near the visitor
    // when the sun is 15° up at dawn and dusk (the shadow camera's near plane is 1 m).
    this.sun.position.copy(focus).addScaledVector(this.sunDir, SUN_SHADOW_DISTANCE);
  }

  dispose(): void {
    for (const o of [this.dome, this.stars, this.moon]) {
      o.geometry.dispose();
      o.material.dispose();
    }
    // Frees the High-tier shadow map render target.
    this.sun.dispose();
  }
}
