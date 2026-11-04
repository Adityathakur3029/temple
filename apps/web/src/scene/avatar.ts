/**
 * Placeholder devotee avatar (spec 02 § Avatar): about 1.6 m, simple rounded forms, kurta with a
 * dhoti or salwar, a wool shawl in one of 8 colours, and barefoot. No face, tilak or other marker.
 *
 * One skinned mesh per visitor, so each costs one draw call (spec 10 § Render budgets): the parts
 * are merged into one geometry with vertex colours, each part bound rigidly to one bone. Geometry
 * is shared by every avatar with the same body, shawl and detail.
 *
 * Animations are procedural: idle, walk and sit (sukhasana, cross-legged, facing the sanctum),
 * and three devotional gestures: namaste (palms joined at the chest with a slight nod, 1.2 s),
 * pranam (a standing bow with joined palms raised to the forehead, 2.5 s) and ringing a bell
 * (reach up and strike, 0.8 s). The rig has no running, jumping, dancing or emote motion at all.
 * M5 replaces this with the skinned asset and vertex animation textures (spec 11).
 */
import {
  Bone,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DetachedBindMode,
  Group,
  Matrix4,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Muted wool shawl colours; the server assigns an index 0–7 (spec 04 `Visitor.shawl`). */
export const SHAWL_COLOURS = [
  "#7a2e2e", // madder red
  "#8f5632", // rust
  "#a88436", // mustard
  "#5f6436", // olive
  "#2f5d5a", // teal
  "#36426b", // indigo
  "#5a3a5a", // plum
  "#4a4a4a", // charcoal
] as const;

const SKIN = "#9a6b4f";
const HAIR = "#2a221d";
const KURTA = "#e6dfce";

/** Stride: metres walked per full walk cycle (two steps), for a calm 1.3 m/s pace. */
const CYCLE_M = 1.45;
/** Sitting down or standing up takes this long. */
const SIT_S = 0.9;

export type Detail = "high" | "low";
export type GestureAnim = "namaste" | "pranam" | "bell";

/** Gesture lengths in seconds (spec 03). */
export const GESTURE_S: Readonly<Record<GestureAnim, number>> = {
  namaste: 1.2,
  pranam: 2.5,
  bell: 0.8,
};

interface Body {
  scale: number;
  shoulder: number;
  hip: number;
  lower: string;
  /** Lower-leg radius at the ankle: wide for a dhoti, narrow for a salwar. */
  ankle: number;
}

const BODIES: readonly Body[] = [
  { scale: 1, shoulder: 0.19, hip: 0.09, lower: "#efe9d8", ankle: 0.075 },
  { scale: 0.96, shoulder: 0.17, hip: 0.095, lower: "#e2d8c3", ankle: 0.05 },
];

const THIGH = 0.42;
const SHIN = 0.4;
const HIP_HEIGHT = THIGH + SHIN + 0.07;

const ease = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Bone order. Every geometry and skeleton uses it. */
const B = {
  root: 0,
  hips: 1,
  spine: 2,
  head: 3,
  upperL: 4,
  foreL: 5,
  upperR: 6,
  foreR: 7,
  thighL: 8,
  shinL: 9,
  footL: 10,
  thighR: 11,
  shinR: 12,
  footR: 13,
  skirt: 14,
} as const;
const BONE_COUNT = 15;

/** The rest pose. Positions only; the update loop sets rotations every frame. */
function makeBones(body: Body): Bone[] {
  const bones = Array.from({ length: BONE_COUNT }, () => new Bone());
  const at = (i: number, parent: number, x: number, y: number, z: number): void => {
    const b = bones[i];
    const p = bones[parent];
    if (!b || !p) return;
    b.position.set(x, y, z);
    p.add(b);
  };
  at(B.hips, B.root, 0, HIP_HEIGHT, 0);
  at(B.spine, B.hips, 0, 0, 0);
  at(B.head, B.spine, 0, 0.52, 0);
  at(B.upperL, B.spine, body.shoulder + 0.02, 0.47, 0);
  at(B.foreL, B.upperL, 0, -0.28, 0);
  at(B.upperR, B.spine, -(body.shoulder + 0.02), 0.47, 0);
  at(B.foreR, B.upperR, 0, -0.28, 0);
  at(B.thighL, B.hips, body.hip, -0.02, 0);
  at(B.shinL, B.thighL, 0, -THIGH, 0);
  at(B.footL, B.shinL, 0, -SHIN - 0.02, 0.05);
  at(B.thighR, B.hips, -body.hip, -0.02, 0);
  at(B.shinR, B.thighR, 0, -THIGH, 0);
  at(B.footR, B.shinR, 0, -SHIN - 0.02, 0.05);
  at(B.skirt, B.hips, 0, -0.13, 0);
  for (const i of [B.thighL, B.thighR]) bones[i]?.rotation.set(0, 0, 0, "YXZ");
  for (const i of [B.shinL, B.shinR]) bones[i]?.rotation.set(0, 0, 0, "ZXY");
  return bones;
}

const geometryCache = new Map<string, BufferGeometry>();

/** One merged, rigidly skinned geometry for a body, shawl and level of detail. */
function avatarGeometry(bodyIndex: 0 | 1, shawl: number, detail: Detail): BufferGeometry {
  const key = `${bodyIndex}:${shawl}:${detail}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const body = BODIES[bodyIndex] ?? BODIES[0];
  if (!body) throw new Error("no avatar body");
  const bones = makeBones(body);
  bones[0]?.updateMatrixWorld(true);
  const hi = detail === "high";
  const seg = (n: number): number => (hi ? n : Math.max(5, Math.round(n * 0.6)));
  const parts: BufferGeometry[] = [];
  const local = new Matrix4();
  const colour = new Color();

  const part = (
    g: BufferGeometry,
    hex: string,
    bone: number,
    y = 0,
    opts: { x?: number; z?: number; rotX?: number; scale?: [number, number, number] } = {},
  ): void => {
    local.makeRotationX(opts.rotX ?? 0);
    if (opts.scale) local.scale(new Vector3(...opts.scale));
    local.setPosition(opts.x ?? 0, y, opts.z ?? 0);
    const b = bones[bone];
    if (!b) return;
    g.applyMatrix4(new Matrix4().multiplyMatrices(b.matrixWorld, local));
    g.deleteAttribute("uv");
    const n = g.getAttribute("position").count;
    colour.set(hex);
    const colours = new Float32Array(n * 3);
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colours.set([colour.r, colour.g, colour.b], i * 3);
      skinIndex[i * 4] = bone;
      skinWeight[i * 4] = 1;
    }
    g.setAttribute("color", new BufferAttribute(colours, 3));
    g.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
    g.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
    parts.push(g);
  };

  const shawlHex = SHAWL_COLOURS[shawl % SHAWL_COLOURS.length] ?? SHAWL_COLOURS[0];
  // Torso, kurta hem and shawl.
  part(new CylinderGeometry(body.shoulder - 0.02, 0.16, 0.5, seg(12)), KURTA, B.spine, 0.25);
  part(new CylinderGeometry(0.165, 0.19, 0.3, seg(12)), KURTA, B.skirt);
  part(
    new CylinderGeometry(body.shoulder + 0.01, body.shoulder - 0.005, 0.3, seg(12)),
    shawlHex,
    B.spine,
    0.36,
  );
  part(
    new SphereGeometry(body.shoulder + 0.012, seg(12), hi ? 6 : 4, 0, Math.PI * 2, 0, Math.PI / 2),
    shawlHex,
    B.spine,
    0.5,
  );
  // Neck and head: no face, no markers.
  part(new CylinderGeometry(0.045, 0.05, 0.08, seg(8)), SKIN, B.head, 0.03);
  part(new SphereGeometry(0.105, seg(16), hi ? 12 : 7), SKIN, B.head, 0.15);
  part(
    new SphereGeometry(0.11, seg(16), hi ? 8 : 5, 0, Math.PI * 2, 0, Math.PI / 2),
    HAIR,
    B.head,
    0.16,
    { rotX: -0.25 },
  );
  if (bodyIndex === 1)
    part(new SphereGeometry(0.055, seg(10), hi ? 8 : 5), HAIR, B.head, 0.17, { z: -0.1 });
  // Arms: sleeves in the kurta cloth, shawl over the shoulders, hands in skin.
  for (const [upper, fore] of [
    [B.upperL, B.foreL],
    [B.upperR, B.foreR],
  ] as const) {
    part(new SphereGeometry(0.06, seg(8), hi ? 6 : 4), shawlHex, upper);
    part(new CylinderGeometry(0.05, 0.045, 0.28, seg(8)), KURTA, upper, -0.14);
    part(new CylinderGeometry(0.043, 0.036, 0.24, seg(8)), KURTA, fore, -0.12);
    part(new SphereGeometry(0.045, seg(8), hi ? 6 : 4), SKIN, fore, -0.27);
  }
  // Legs: dhoti or salwar, and bare feet.
  for (const [thigh, shin, foot] of [
    [B.thighL, B.shinL, B.footL],
    [B.thighR, B.shinR, B.footR],
  ] as const) {
    part(new CylinderGeometry(0.085, 0.07, THIGH, seg(10)), body.lower, thigh, -THIGH / 2);
    part(new CylinderGeometry(0.068, body.ankle, SHIN, seg(10)), body.lower, shin, -SHIN / 2);
    part(new SphereGeometry(0.05, seg(10), hi ? 6 : 4), SKIN, foot, 0, { scale: [0.9, 0.55, 2.1] });
  }

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("avatar geometry did not merge");
  geometryCache.set(key, merged);
  return merged;
}

let sharedMaterial: MeshLambertMaterial | null = null;
function avatarMaterial(): MeshLambertMaterial {
  return (sharedMaterial ??= new MeshLambertMaterial({ vertexColors: true }));
}

/** Builds every body, shawl and detail now (during boot), so none is built mid-walk. */
export function prebuildAvatarGeometries(): void {
  for (const body of [0, 1] as const) {
    for (let shawl = 0; shawl < SHAWL_COLOURS.length; shawl++) {
      for (const detail of ["high", "low"] as const) avatarGeometry(body, shawl, detail);
    }
  }
}

/** Frees the shared geometries and material (when the temple closes). */
export function disposeAvatarCache(): void {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

/** 0 → 1 → 0 over a gesture: eased in, held, eased out. */
function envelope(t: number, length: number, inS = 0.25, outS = 0.3): number {
  if (t <= 0 || t >= length) return 0;
  if (t < inS) return ease(t / inS);
  if (t > length - outS) return ease((length - t) / outS);
  return 1;
}

export class Avatar {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  private readonly bones: Bone[];
  // Resolved once, so the per-frame update allocates nothing (spec 10 § Frame loop hygiene).
  private readonly rootBone: Bone;
  private readonly hips: Bone;
  private readonly spine: Bone;
  private readonly head: Bone;
  private readonly skirt: Bone;
  private readonly ul: Bone;
  private readonly fl: Bone;
  private readonly ur: Bone;
  private readonly fr: Bone;
  private readonly tl: Bone;
  private readonly sl: Bone;
  private readonly tr: Bone;
  private readonly sr: Bone;
  private readonly footL: Bone;
  private readonly footR: Bone;
  /** The pose changed since the bone texture was last uploaded. */
  private poseDirty = true;
  private readonly bodyIndex: 0 | 1;
  private readonly shawl: number;
  private detailLevel: Detail;

  /** 0 standing … 1 seated. */
  sitBlend = 0;
  private sitTarget = 0;
  private walkAmount = 0;
  private time = 0;
  private gesture: { kind: GestureAnim; t: number } | null = null;

  constructor(opts: { shawl: number; body: 0 | 1; detail?: Detail }) {
    this.bodyIndex = opts.body === 1 ? 1 : 0;
    this.shawl = opts.shawl;
    this.detailLevel = opts.detail ?? "high";
    const body = BODIES[this.bodyIndex] ?? BODIES[0];
    if (!body) throw new Error("no avatar body");
    this.bones = makeBones(body);
    const bone = (i: number): Bone => {
      const b = this.bones[i];
      if (!b) throw new Error(`no bone ${i}`);
      return b;
    };
    this.rootBone = bone(B.root);
    this.hips = bone(B.hips);
    this.spine = bone(B.spine);
    this.head = bone(B.head);
    this.skirt = bone(B.skirt);
    this.ul = bone(B.upperL);
    this.fl = bone(B.foreL);
    this.ur = bone(B.upperR);
    this.fr = bone(B.foreR);
    this.tl = bone(B.thighL);
    this.sl = bone(B.shinL);
    this.tr = bone(B.thighR);
    this.sr = bone(B.shinR);
    this.footL = bone(B.footL);
    this.footR = bone(B.footR);
    this.mesh = new SkinnedMesh(
      avatarGeometry(this.bodyIndex, this.shawl, this.detailLevel),
      avatarMaterial(),
    );
    // The bones live outside the scene graph, in the avatar's own space (detached bind mode),
    // so walking moves only the mesh. The bone texture is uploaded only when the pose changes:
    // far avatars animate at 10 Hz and still ones not at all (spec 10).
    this.rootBone.updateMatrixWorld(true);
    const skeleton = new Skeleton(this.bones);
    this.mesh.bindMode = DetachedBindMode;
    this.mesh.bind(skeleton, new Matrix4());
    const upload = skeleton.update.bind(skeleton);
    skeleton.update = () => {
      if (!this.poseDirty) return;
      this.poseDirty = false;
      upload();
    };
    // Fixed bounds that cover every pose, so culling never re-skins the mesh on the CPU.
    this.mesh.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.15);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.root.scale.setScalar(body.scale);
  }

  get detail(): Detail {
    return this.detailLevel;
  }

  /** Near avatars use the finer geometry (spec 10 § Techniques the budgets assume). */
  setDetail(detail: Detail): void {
    if (detail === this.detailLevel) return;
    this.detailLevel = detail;
    this.mesh.geometry = avatarGeometry(this.bodyIndex, this.shawl, detail);
  }

  /** Begin sitting down (true) or standing up (false). */
  setSeated(seated: boolean): void {
    this.sitTarget = seated ? 1 : 0;
  }

  /** True once the avatar has fully stood up (walking may start). */
  get standing(): boolean {
    return this.sitBlend < 0.02 && this.sitTarget === 0;
  }

  /** Starts a gesture from the beginning. */
  play(kind: GestureAnim): void {
    this.gesture = { kind, t: 0 };
  }

  /** The gesture playing now, if any. */
  get playing(): GestureAnim | null {
    return this.gesture?.kind ?? null;
  }

  /**
   * @param speed metres per second moved this frame
   * @param travelled total distance walked (drives the stride, so feet don't slide)
   */
  update(dt: number, speed: number, travelled: number): void {
    this.time += dt;
    const step = dt / SIT_S;
    // Towards the target, and then hold: a blend that overshoots and comes back each frame
    // would flicker between seated and standing.
    if (this.sitTarget > this.sitBlend)
      this.sitBlend = Math.min(this.sitTarget, this.sitBlend + step);
    else if (this.sitTarget < this.sitBlend)
      this.sitBlend = Math.max(this.sitTarget, this.sitBlend - step);
    const target = Math.min(1, speed / 1.2);
    this.walkAmount += (target - this.walkAmount) * Math.min(1, dt * 8);

    const g = this.gesture;
    let namaste = 0;
    let pranam = 0;
    let bell = 0;
    let gt = 0;
    if (g) {
      g.t += dt;
      gt = g.t;
      const length = GESTURE_S[g.kind];
      if (g.t >= length) this.gesture = null;
      else if (g.kind === "namaste") namaste = envelope(g.t, length);
      else if (g.kind === "pranam") pranam = envelope(g.t, length, 0.5, 0.6);
      else bell = envelope(g.t, length, 0.2, 0.25);
    }
    const palms = Math.max(namaste, pranam);

    const s = ease(this.sitBlend);
    // Walking legs keep their stride during a gesture; only the arm swing gives way to it.
    const w = this.walkAmount * (1 - s);
    const wArms = w * (1 - palms);
    const phase = (travelled / CYCLE_M) * Math.PI * 2;
    const breath = Math.sin(this.time * 1.3) * 0.012;
    const { hips, spine, head, ul, fl, ur, fr, tl, sl, tr, sr } = this;

    // Hips drop onto the mat when seated; a small bob while walking.
    hips.position.y = lerp(HIP_HEIGHT - Math.abs(Math.cos(phase)) * 0.012 * w, 0.17, s);
    // A standing bow leans forward from the hips; seated, only the head bows.
    const bow = pranam * (1 - s);
    spine.rotation.set(breath + 0.42 * bow + 0.12 * pranam * s, Math.sin(phase) * 0.06 * w, 0);
    // Namaste: a slight nod in the middle of the gesture.
    const nod = namaste * Math.sin(Math.min(1, gt / GESTURE_S.namaste) * Math.PI);
    head.rotation.x = lerp(0.02, 0.08, s) + 0.2 * nod + 0.2 * pranam;
    this.skirt.scale.y = lerp(1, 0.35, s);

    // Legs. Standing: swing with the stride. Seated: thighs forward and out, shins crossed (left
    // over right), feet lying along the shins with the soles down, never towards the sanctum.
    const swing = Math.sin(phase) * 0.42 * w;
    const kneeL = Math.max(0, Math.cos(phase)) * 0.75 * w;
    const kneeR = Math.max(0, -Math.cos(phase)) * 0.75 * w;
    tl.rotation.set(lerp(-swing, -1.36, s), lerp(0, 0.95, s), 0);
    tr.rotation.set(lerp(swing, -1.36, s), lerp(0, -0.95, s), 0);
    sl.rotation.set(lerp(kneeL, -0.15, s), 0, lerp(0, -2.3, s));
    sr.rotation.set(lerp(kneeR, 0.12, s), 0, lerp(0, 2.3, s));
    this.footL.rotation.x = lerp(0, 1.4, s);
    this.footR.rotation.x = this.footL.rotation.x;

    // Arms. Standing: hang and swing opposite the legs. Seated: hands rest in the lap.
    const armSwing = Math.sin(phase) * 0.32 * wArms;
    let ulx = lerp(armSwing, -0.55, s);
    let ulz = lerp(0.07, -0.18, s);
    let urx = lerp(-armSwing, -0.55, s);
    let urz = lerp(-0.07, 0.18, s);
    let flx = lerp(-0.12 - 0.15 * wArms, -1.05, s);
    let flz = lerp(0, -0.35, s);
    let frx = flx;
    let frz = -flz;

    // Joined palms: at the chest for namaste, raised to the forehead for pranam.
    if (palms > 0) {
      const up = pranam / Math.max(palms, 1e-6);
      ulx = lerp(ulx, lerp(-0.3, -1.35, up), palms);
      urx = lerp(urx, lerp(-0.3, -1.35, up), palms);
      ulz = lerp(ulz, -0.3, palms);
      urz = lerp(urz, 0.3, palms);
      flx = lerp(flx, lerp(-1.7, -2.25, up), palms);
      frx = lerp(frx, lerp(-1.7, -2.25, up), palms);
      flz = lerp(flz, -0.62, palms);
      frz = lerp(frz, 0.62, palms);
    }
    // Ringing a bell: the right arm reaches up and strikes once in the middle.
    if (bell > 0) {
      const strike = Math.sin(Math.min(1, gt / GESTURE_S.bell) * Math.PI * 2) * 0.22;
      urx = lerp(urx, -2.75 + strike, bell);
      urz = lerp(urz, 0.12, bell);
      frx = lerp(frx, -0.35, bell);
      frz = lerp(frz, 0, bell);
    }
    ul.rotation.set(ulx, 0, ulz);
    ur.rotation.set(urx, 0, urz);
    fl.rotation.set(flx, 0, flz);
    fr.rotation.set(frx, 0, frz);
    this.rootBone.updateMatrixWorld(true);
    this.poseDirty = true;
  }

  dispose(): void {
    // Geometry and material are shared (disposeAvatarCache); the skeleton's bone texture is not.
    this.mesh.skeleton.dispose();
    this.root.removeFromParent();
  }
}
