/**
 * The devotee avatar (spec 02 § Avatar): short and rounded, about 1.17 m and a little over three
 * heads tall (a big round head, short legs, stubby arms), kurta with a dhoti or salwar, a wool
 * shawl in one of 8 colours, and barefoot. No eyes, mouth, tilak or other marker.
 *
 * The figure is the `avatar` slot's model (assets-src/models/avatar, made in Blender) once it has
 * loaded (setAvatarModel), and a greybox figure built here from simple shapes until then or if
 * it fails. Both use the same bones, so the animation below drives either.
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
  BufferGeometry,
  DetachedBindMode,
  Group,
  Matrix3,
  Matrix4,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
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

/** Stride: metres walked per full walk cycle (two steps); short legs take quick small steps. */
const CYCLE_M = 0.8;
/** How far each leg swings forward and back while walking, in radians. */
const SWING = 0.5;
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
  /** Extra outward forearm turn for joined palms, so narrower shoulders don't overlap the palms. */
  palmsOut: number;
}

const BODIES: readonly Body[] = [
  { scale: 1, shoulder: 0.145, hip: 0.07, lower: "#efe9d8", ankle: 0.062, palmsOut: 0 },
  { scale: 0.96, shoulder: 0.135, hip: 0.072, lower: "#e2d8c3", ankle: 0.042, palmsOut: 0.07 },
];

/**
 * Joined palms (spec 03), for the left arm; the right mirrors it. Upper arm (x, z), forearm
 * (x, z) and wrist (x, y, z): the palms press together with the fingers up, in front of the chest
 * for namaste, and for pranam (with its bow) with the fingertips touching the forehead. Solved
 * for body 0 with assets-src/models/avatar/make_avatar.py, which previews the same poses in
 * Blender.
 */
const NAMASTE_POSE = {
  upper: [-0.724, -0.104],
  fore: [-1.131, -0.907],
  wrist: [-0.87, -0.867, 0.467],
} as const;
const PRANAM_POSE = {
  upper: [-1.749, -0.367],
  fore: [-0.716, -0.251],
  wrist: [-0.515, -0.491, 0.319],
} as const;

// Proportions, in metres. assets-src/models/avatar/make_avatar.py uses the same numbers.
const THIGH = 0.2;
const SHIN = 0.18;
const HIP_HEIGHT = THIGH + SHIN + 0.07;
/** The neck joint and the shoulder joints, above the hips. */
const SPINE_HEAD = 0.35;
const SPINE_SHOULDER = 0.31;
/** Shoulder to elbow, and elbow to wrist. */
const UPPER_ARM = 0.18;
const FOREARM = 0.15;
/** The kurta hem's bone, below the hips. */
const SKIRT = -0.07;
/** Ankle to the foot bone, forward. */
const FOOT_Z = 0.04;
/** Hips above the mat when seated. */
const SEATED_HIP = 0.12;

/**
 * Heights above the floor: the point the camera follows (a little below the middle of the head),
 * and where a name label floats, standing and seated (body 0; body 1 is 4% shorter).
 */
export const HEAD_HEIGHT = { standing: 0.9, seated: 0.6 } as const;
export const LABEL_HEIGHT = { standing: 1.35, seated: 1.03 } as const;

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
  handL: 15,
  handR: 16,
} as const;
const BONE_COUNT = 17;
/** Bone names as in the avatar model (`b<body>-<name>`), by index. */
const BONE_NAMES = Object.keys(B) as (keyof typeof B)[];

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
  at(B.head, B.spine, 0, SPINE_HEAD, 0);
  at(B.upperL, B.spine, body.shoulder + 0.02, SPINE_SHOULDER, 0);
  at(B.foreL, B.upperL, 0, -UPPER_ARM, 0);
  at(B.upperR, B.spine, -(body.shoulder + 0.02), SPINE_SHOULDER, 0);
  at(B.foreR, B.upperR, 0, -UPPER_ARM, 0);
  at(B.thighL, B.hips, body.hip, -0.02, 0);
  at(B.shinL, B.thighL, 0, -THIGH, 0);
  at(B.footL, B.shinL, 0, -SHIN - 0.02, FOOT_Z);
  at(B.thighR, B.hips, -body.hip, -0.02, 0);
  at(B.shinR, B.thighR, 0, -THIGH, 0);
  at(B.footR, B.shinR, 0, -SHIN - 0.02, FOOT_Z);
  at(B.skirt, B.hips, 0, SKIRT, 0);
  at(B.handL, B.foreL, 0, -FOREARM, 0);
  at(B.handR, B.foreR, 0, -FOREARM, 0);
  for (const i of [B.thighL, B.thighR]) bones[i]?.rotation.set(0, 0, 0, "YXZ");
  for (const i of [B.shinL, B.shinR]) bones[i]?.rotation.set(0, 0, 0, "ZXY");
  return bones;
}

const geometryCache = new Map<string, BufferGeometry>();

/** One body at one level of detail from the avatar model, in the avatar's own space. */
interface ModelLod {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** 1 on the shawl, whose colour is a grey shade for the visitor's shawl colour. */
  shawl: Uint8Array;
  bone: Uint16Array;
  index: Uint32Array;
}

/** The avatar slot's model, by `${body}:${detail}`, once loaded. */
let model: Map<string, ModelLod> | null = null;
/** Avatars alive now, so a model arriving later can replace their greybox geometry. */
const live = new Set<Avatar>();

const MESH_NAME = /^body([01])-(high|low)$/;

/** One primitive of the model as plain arrays, in its rest pose. */
function readPrimitive(mesh: SkinnedMesh, isShawl: boolean): ModelLod {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const skin = g.getAttribute("skinIndex");
  if (!skin) throw new Error(`${mesh.name} isn't skinned`);
  const n = pos.count;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const color = new Float32Array(n * 3).fill(1);
  const bone = new Uint16Array(n);
  const boneIndex = mesh.skeleton.bones.map((b) => {
    const name = b.name.replace(/^b[01]-/, "").replace(/_\d+$/, "");
    const i = BONE_NAMES.indexOf(name as keyof typeof B);
    if (i < 0) throw new Error(`unknown avatar bone "${b.name}"`);
    return i;
  });
  // Built models are quantised, with the scale folded into the skin, so each vertex is read
  // through the skin at rest rather than as stored.
  const toWorld = mesh.matrixWorld;
  const normalMatrix = new Matrix3().getNormalMatrix(toWorld);
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(toWorld);
    position.set([v.x, v.y, v.z], i * 3);
    if (nor) {
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      normal.set([v.x, v.y, v.z], i * 3);
    }
    if (col) color.set([col.getX(i), col.getY(i), col.getZ(i)], i * 3);
    // Rigid skinning: the first joint carries the vertex.
    bone[i] = boneIndex[skin.getX(i)] ?? 0;
  }
  const idx = g.getIndex();
  const index = idx ? Uint32Array.from(idx.array) : Uint32Array.from({ length: n }, (_, i) => i);
  return { position, normal, color, bone, index, shawl: new Uint8Array(n).fill(isShawl ? 1 : 0) };
}

/** Joins a body's primitives (body and shawl) into one. */
function joinLods(list: readonly ModelLod[]): ModelLod {
  const verts = list.reduce((n, p) => n + p.bone.length, 0);
  const tris = list.reduce((n, p) => n + p.index.length, 0);
  const out: ModelLod = {
    position: new Float32Array(verts * 3),
    normal: new Float32Array(verts * 3),
    color: new Float32Array(verts * 3),
    shawl: new Uint8Array(verts),
    bone: new Uint16Array(verts),
    index: new Uint32Array(tris),
  };
  let v = 0;
  let t = 0;
  for (const p of list) {
    out.position.set(p.position, v * 3);
    out.normal.set(p.normal, v * 3);
    out.color.set(p.color, v * 3);
    out.shawl.set(p.shawl, v);
    out.bone.set(p.bone, v);
    for (let i = 0; i < p.index.length; i++) out.index[t + i] = (p.index[i] ?? 0) + v;
    v += p.bone.length;
    t += p.index.length;
  }
  return out;
}

/**
 * Takes the avatar slot's model (scene/models.ts) and puts it on every avatar, now and later.
 * Copies what it needs, so the caller may dispose the model afterwards. Throws, leaving the
 * greybox figure, if the model lacks a body or a level of detail.
 */
export function setAvatarModel(root: Object3D): void {
  root.updateMatrixWorld(true);
  const parts = new Map<string, ModelLod[]>();
  root.traverse((o) => {
    if (!(o as SkinnedMesh).isSkinnedMesh) return;
    const mesh = o as SkinnedMesh;
    let named: Object3D | null = mesh;
    let m: RegExpExecArray | null = null;
    while (named && !(m = MESH_NAME.exec(String(named.userData.name ?? named.name)))) {
      named = named.parent;
    }
    if (!m) return;
    const mats = mesh.material as Material | Material[];
    const first = Array.isArray(mats) ? mats[0] : mats;
    const key = `${m[1]}:${m[2]}`;
    parts.set(key, [
      ...(parts.get(key) ?? []),
      readPrimitive(mesh, !!first?.name.includes("shawl")),
    ]);
  });
  const next = new Map<string, ModelLod>();
  for (const key of ["0:high", "0:low", "1:high", "1:low"]) {
    const list = parts.get(key);
    if (!list) throw new Error(`the avatar model has no body${key.replace(":", "-")}`);
    next.set(key, joinLods(list));
  }
  model = next;
  // Build every geometry from the model now (as at boot), then move the avatars onto them.
  const old = [...geometryCache.values()];
  geometryCache.clear();
  prebuildAvatarGeometries();
  for (const a of live) a.refreshGeometry();
  for (const g of old) g.dispose();
}

/** A geometry from the avatar model, with the shawl in the visitor's colour. */
function modelGeometry(lod: ModelLod, shawl: number): BufferGeometry {
  const n = lod.bone.length;
  const tint = new Color(SHAWL_COLOURS[shawl % SHAWL_COLOURS.length] ?? SHAWL_COLOURS[0]);
  const color = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const on = lod.shawl[i] === 1;
    color[i * 3] = (lod.color[i * 3] ?? 1) * (on ? tint.r : 1);
    color[i * 3 + 1] = (lod.color[i * 3 + 1] ?? 1) * (on ? tint.g : 1);
    color[i * 3 + 2] = (lod.color[i * 3 + 2] ?? 1) * (on ? tint.b : 1);
    skinIndex[i * 4] = lod.bone[i] ?? 0;
    skinWeight[i * 4] = 1;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(lod.position, 3));
  g.setAttribute("normal", new BufferAttribute(lod.normal, 3));
  g.setAttribute("color", new BufferAttribute(color, 3));
  g.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
  g.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
  g.setIndex(new BufferAttribute(lod.index, 1));
  return g;
}

/** One merged, rigidly skinned geometry for a body, shawl and level of detail. */
function avatarGeometry(bodyIndex: 0 | 1, shawl: number, detail: Detail): BufferGeometry {
  const key = `${bodyIndex}:${shawl}:${detail}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const lod = model?.get(`${bodyIndex}:${detail}`);
  if (lod) {
    const g = modelGeometry(lod, shawl);
    geometryCache.set(key, g);
    return g;
  }

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
  part(new CylinderGeometry(body.shoulder - 0.01, 0.135, 0.34, seg(12)), KURTA, B.spine, 0.17);
  part(new CylinderGeometry(0.135, 0.16, 0.18, seg(12)), KURTA, B.skirt);
  part(
    new CylinderGeometry(body.shoulder + 0.01, body.shoulder - 0.005, 0.2, seg(12)),
    shawlHex,
    B.spine,
    0.22,
  );
  part(
    new SphereGeometry(body.shoulder + 0.012, seg(12), hi ? 6 : 4, 0, Math.PI * 2, 0, Math.PI / 2),
    shawlHex,
    B.spine,
    0.32,
  );
  // Neck and a big round head: no face, no markers.
  part(new CylinderGeometry(0.04, 0.045, 0.06, seg(8)), SKIN, B.head, 0.02);
  part(new SphereGeometry(0.165, seg(16), hi ? 12 : 7), SKIN, B.head, 0.18);
  part(
    new SphereGeometry(0.172, seg(16), hi ? 8 : 5, 0, Math.PI * 2, 0, Math.PI / 2),
    HAIR,
    B.head,
    0.19,
    { rotX: -0.25 },
  );
  if (bodyIndex === 1)
    part(new SphereGeometry(0.065, seg(10), hi ? 8 : 5), HAIR, B.head, 0.21, { z: -0.16 });
  // Arms: sleeves in the kurta cloth, shawl over the shoulders, hands in skin.
  for (const [upper, fore, hand] of [
    [B.upperL, B.foreL, B.handL],
    [B.upperR, B.foreR, B.handR],
  ] as const) {
    part(new SphereGeometry(0.05, seg(8), hi ? 6 : 4), shawlHex, upper);
    part(new CylinderGeometry(0.042, 0.038, UPPER_ARM, seg(8)), KURTA, upper, -UPPER_ARM / 2);
    part(new CylinderGeometry(0.036, 0.032, FOREARM, seg(8)), KURTA, fore, -FOREARM / 2);
    part(new SphereGeometry(0.038, seg(8), hi ? 6 : 4), SKIN, hand, -0.04);
  }
  // Legs: dhoti or salwar, and bare feet.
  for (const [thigh, shin, foot] of [
    [B.thighL, B.shinL, B.footL],
    [B.thighR, B.shinR, B.footR],
  ] as const) {
    part(new CylinderGeometry(0.068, 0.06, THIGH, seg(10)), body.lower, thigh, -THIGH / 2);
    part(new CylinderGeometry(0.058, body.ankle, SHIN, seg(10)), body.lower, shin, -SHIN / 2);
    part(new SphereGeometry(0.045, seg(10), hi ? 6 : 4), SKIN, foot, 0, { scale: [0.9, 0.6, 2] });
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
  private readonly hl: Bone;
  private readonly hr: Bone;
  /** The pose changed since the bone texture was last uploaded. */
  private poseDirty = true;
  private readonly bodyIndex: 0 | 1;
  private readonly body: Body;
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
    this.body = body;
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
    this.hl = bone(B.handL);
    this.hr = bone(B.handR);
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
    this.mesh.boundingSphere = new Sphere(new Vector3(0, 0.6, 0), 0.8);
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.root.scale.setScalar(body.scale);
    live.add(this);
  }

  /** Picks up the avatar model's geometry once it has loaded (setAvatarModel). */
  refreshGeometry(): void {
    this.mesh.geometry = avatarGeometry(this.bodyIndex, this.shawl, this.detailLevel);
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
    hips.position.y = lerp(HIP_HEIGHT - Math.abs(Math.cos(phase)) * 0.012 * w, SEATED_HIP, s);
    // A standing bow leans forward from the hips; seated, only the head bows.
    const bow = pranam * (1 - s);
    spine.rotation.set(breath + 0.42 * bow + 0.12 * pranam * s, Math.sin(phase) * 0.06 * w, 0);
    // Namaste: a slight nod in the middle of the gesture.
    const nod = namaste * Math.sin(Math.min(1, gt / GESTURE_S.namaste) * Math.PI);
    head.rotation.x = lerp(0.02, 0.08, s) + 0.2 * nod + 0.2 * pranam;
    this.skirt.scale.y = lerp(1, 0.35, s);

    // Legs. Standing: swing with the stride. Seated: thighs forward and out, shins crossed (left
    // over right), feet lying along the shins with the soles down, never towards the sanctum.
    const swing = Math.sin(phase) * SWING * w;
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

    // Joined palms, fingers up: at the chest for namaste, raised to the forehead for pranam.
    let wx = 0;
    let wy = 0;
    let wz = 0;
    if (palms > 0) {
      const up = pranam / Math.max(palms, 1e-6);
      const N = NAMASTE_POSE;
      const P = PRANAM_POSE;
      const ux = lerp(N.upper[0], P.upper[0], up);
      const uz = lerp(N.upper[1], P.upper[1], up);
      const fx = lerp(N.fore[0], P.fore[0], up);
      const fz = lerp(N.fore[1], P.fore[1], up) + this.body.palmsOut;
      ulx = lerp(ulx, ux, palms);
      urx = lerp(urx, ux, palms);
      ulz = lerp(ulz, uz, palms);
      urz = lerp(urz, -uz, palms);
      flx = lerp(flx, fx, palms);
      frx = lerp(frx, fx, palms);
      flz = lerp(flz, fz, palms);
      frz = lerp(frz, -fz, palms);
      wx = lerp(N.wrist[0], P.wrist[0], up) * palms;
      wy = lerp(N.wrist[1], P.wrist[1], up) * palms;
      wz = lerp(N.wrist[2], P.wrist[2], up) * palms;
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
    this.hl.rotation.set(wx, wy, wz);
    this.hr.rotation.set(wx, -wy, -wz);
    this.rootBone.updateMatrixWorld(true);
    this.poseDirty = true;
  }

  dispose(): void {
    // Geometry and material are shared (disposeAvatarCache); the skeleton's bone texture is not.
    this.mesh.skeleton.dispose();
    this.root.removeFromParent();
    live.delete(this);
  }
}
