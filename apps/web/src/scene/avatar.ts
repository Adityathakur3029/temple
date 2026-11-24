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
 * (reach up and strike, 0.8 s), and washing the hands at a tap (lean a little, cup the hands under
 * the spout and rub them, then shake the water off gently, 4 s), and whispering to Nandi (lean a
 * little towards his ear with a hand cupped by the mouth, then join the palms and nod, 4 s), and
 * making an offering in the sanctum (spec 03): pouring water from a small copper lota onto the
 * linga (8 s), laying a bel patra or a flower on the linga with a slight bow (4 s), and, back at
 * the threshold, receiving charanamrit in cupped
 * hands, raising them to the lips and passing the right hand over the head (3.5 s). The lota,
 * leaf and flower are small props held between the hands. The rig has no running, jumping,
 * dancing or emote motion at all.
 * M5 replaces this with the skinned asset and vertex animation textures (spec 11).
 */
import {
  Bone,
  BufferAttribute,
  CircleGeometry,
  DoubleSide,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector2,
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
  Euler,
  Quaternion,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LINGA } from "@sannidhi/protocol";
import { PLINTH } from "./ground";

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
export type GestureAnim =
  "namaste" | "pranam" | "bell" | "wash" | "whisper" | "pour" | "bilva" | "flower" | "charanamrit";

/** Washing the hands at a tap (spec 03 § Wash hands). */
export const WASH_S = 4;
/** Whispering to Nandi (spec 03 § Whisper to Nandi): the lean, then joined palms and a nod. */
export const WHISPER_S = 4;
/** The lean lasts this long; the joined palms and the nod take the rest. */
const WHISPER_LEAN_S = 3.1;
/** Pouring water from the lota onto the linga, in the sanctum (spec 03). */
export const POUR_S = 8;
/** Laying a bel patra or a flower on the linga (spec 03). */
export const LAY_S = 4;
/** The leaf or flower leaves the hands this far into the gesture, onto the linga. */
export const LAY_RELEASE_S = 2.3;
/** Receiving charanamrit (spec 03). */
export const CHARANAMRIT_S = 3.5;

/** Gesture lengths in seconds (spec 03). */
export const GESTURE_S: Readonly<Record<GestureAnim, number>> = {
  namaste: 1.2,
  pranam: 2.5,
  bell: 0.8,
  wash: WASH_S,
  whisper: WHISPER_S,
  pour: POUR_S,
  bilva: LAY_S,
  flower: LAY_S,
  charanamrit: CHARANAMRIT_S,
};

/** `envelope` over the window [a, b] of the gesture's time. */
function windowed(t: number, a: number, b: number, fade: number): number {
  return envelope(t - a, b - a, fade, fade);
}

/**
 * The small props held between the hands at the jal spot: a copper lota (with its stream while
 * pouring), a trifoliate bel patra and a small white flower. Shared by every avatar; each avatar
 * makes its own meshes only when it first needs them.
 */
let propParts: {
  lota: LatheGeometry;
  copper: MeshLambertMaterial;
  stream: CylinderGeometry;
  water: MeshBasicMaterial;
  /** The bel patra's three leaflets, merged: one draw. */
  belPatra: BufferGeometry;
  leaf: MeshLambertMaterial;
  /** The white flower's petals and pale bud, merged with vertex colours: one draw. */
  blossom: BufferGeometry;
  blossomMat: MeshLambertMaterial;
} | null = null;

/** A bel patra: three leaflets from one point, the middle one longest. */
function belPatraGeometry(): BufferGeometry {
  const leaflet = new CircleGeometry(0.045, 8);
  const m = new Matrix4();
  const pieces = (
    [
      [0, 1.25],
      [1.0, 1],
      [-1.0, 1],
    ] as const
  ).map(([angle, len]) =>
    leaflet
      .clone()
      .applyMatrix4(
        m.compose(
          new Vector3(-Math.sin(angle) * 0.03 * len, 0, Math.cos(angle) * 0.03 * len),
          new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, angle)),
          new Vector3(0.55, len, 1),
        ),
      ),
  );
  leaflet.dispose();
  const g = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose();
  if (!g) throw new Error("avatar: bel patra did not merge");
  return g;
}

/** A small white jasmine-like flower: six round petals round a pale bud, no yellow (spec 08). */
function blossomGeometry(): BufferGeometry {
  const c = new Color();
  const paint = (g: BufferGeometry, color: string): BufferGeometry => {
    c.set(color);
    const n = g.getAttribute("position").count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new BufferAttribute(rgb, 3));
    return g;
  };
  const pieces: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = new CircleGeometry(0.02, 8).rotateX(-Math.PI / 2);
    pieces.push(paint(petal.translate(Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02), "#f4f1e6"));
  }
  pieces.push(
    paint(new CircleGeometry(0.013, 8).rotateX(-Math.PI / 2).translate(0, 0.002, 0), "#ece4cc"),
  );
  const g = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose();
  if (!g) throw new Error("avatar: flower did not merge");
  return g;
}

function parts(): NonNullable<typeof propParts> {
  propParts ??= {
    // A round-bellied lota with a narrow neck and a lip, about 11 cm tall.
    lota: new LatheGeometry(
      [
        [0, 0],
        [0.035, 0.002],
        [0.055, 0.03],
        [0.058, 0.055],
        [0.045, 0.08],
        [0.028, 0.095],
        [0.03, 0.105],
        [0.036, 0.11],
      ].map(([x, y]) => new Vector2(x, y)),
      12,
    ),
    copper: new MeshLambertMaterial({ color: "#b4643c" }),
    stream: new CylinderGeometry(0.006, 0.01, 1, 6, 1, true),
    water: new MeshBasicMaterial({ color: "#cfe3ee", transparent: true, opacity: 0.55 }),
    belPatra: belPatraGeometry(),
    leaf: new MeshLambertMaterial({ color: "#4f7a32", side: DoubleSide }),
    blossom: blossomGeometry(),
    blossomMat: new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
  };
  return propParts;
}

/** Shared prop geometry and materials, freed with the avatar cache. */
function disposePropParts(): void {
  if (!propParts) return;
  for (const v of Object.values(propParts)) v.dispose();
  propParts = null;
}

interface Props {
  group: Group;
  lota: Mesh;
  stream: Mesh;
  leaf: Mesh;
  flower: Mesh;
}

function makeProps(): Props {
  const P = parts();
  const group = new Group();
  const lota = new Mesh(P.lota, P.copper);
  const stream = new Mesh(P.stream, P.water);
  const leaf = new Mesh(P.belPatra, P.leaf);
  const flower = new Mesh(P.blossom, P.blossomMat);
  group.add(lota, stream, leaf, flower);
  group.visible = false;
  return { group, lota, stream, leaf, flower };
}

const handL = new Vector3();
const handR = new Vector3();
const toTarget = new Vector3();
const lip = new Vector3();
const DOWN = new Vector3(0, -1, 0);
/**
 * Where water is poured and a leaf or flower laid: the top of the linga (the linga slot is 0.92 m
 * tall from the sanctum floor). Used by any avatar offering within OFFER_NEAR_M of it.
 */
const OFFER_TARGET = new Vector3(LINGA.x, PLINTH + 0.015 + 0.9, LINGA.z);
const OFFER_NEAR_M = 1.6;
/** The leaf or flower is carried from the hands onto the linga over this last part of the hold. */
const LAY_CARRY_S = 0.7;
/** 0 below 0, 1 above 1, and an ease in between. */
const smooth01 = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
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
 * On a bench (spec 03 § Sit on a bench): hips this high, so the thighs lie along the seat
 * (BENCH_SEAT_TOP, 0.22 m) and the feet rest flat on the ground; and this far back from the
 * visitor's seat spot, which is in front of the bench, so the figure sits on the slab.
 */
const BENCH_HIP = 0.27;
const BENCH_BACK = 0.42;

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
    const mats = mesh.material;
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
  disposePropParts();
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
  /** Seated (or sitting down, or standing up) on a bench rather than a mat. */
  private onBench = false;
  private walkAmount = 0;
  private time = 0;
  private gesture: { kind: GestureAnim; t: number } | null = null;
  /** Lota, leaf and flower, made the first time this avatar offers at the jal spot. */
  private props: Props | null = null;

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

  /**
   * Begin sitting down (true, or "bench" for a bench seat) or standing up (false). The kind of
   * seat is kept while standing up, so the figure rises from where it sat.
   */
  setSeated(seated: boolean | "bench"): void {
    this.sitTarget = seated ? 1 : 0;
    if (seated) this.onBench = seated === "bench";
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
    let wash = 0;
    let whisper = 0;
    let pour = 0;
    let tilt = 0;
    let hold = 0;
    let reach = 0;
    let cup = 0;
    let sip = 0;
    let overHead = 0;
    let gt = 0;
    if (g) {
      g.t += dt;
      gt = g.t;
      const length = GESTURE_S[g.kind];
      if (g.t >= length) this.gesture = null;
      else if (g.kind === "namaste") namaste = envelope(g.t, length);
      else if (g.kind === "pranam") pranam = envelope(g.t, length, 0.5, 0.6);
      else if (g.kind === "wash") wash = envelope(g.t, length, 0.5, 0.5);
      else if (g.kind === "whisper") {
        whisper = envelope(g.t, WHISPER_LEAN_S, 0.6, 0.5);
        // The palms join as the hand leaves the mouth, and stay joined for the nod.
        namaste =
          g.t > WHISPER_LEAN_S - 0.5
            ? envelope(g.t - (WHISPER_LEAN_S - 0.5), length - (WHISPER_LEAN_S - 0.5), 0.5, 0.3)
            : 0;
      } else if (g.kind === "pour") {
        // Lota held in both hands, tipped towards the linga, then lowered; palms join at the end.
        pour = envelope(g.t, length - 0.9, 0.8, 0.6);
        tilt = windowed(g.t, 1.3, length - 1.8, 0.9);
        namaste = windowed(g.t, length - 1.3, length, 0.35);
      } else if (g.kind === "bilva" || g.kind === "flower") {
        // Held at the chest, laid on the linga with a slight bow, then palms joined.
        hold = envelope(g.t, LAY_RELEASE_S + 0.4, 0.4, 0.4);
        reach = windowed(g.t, 1.0, LAY_RELEASE_S + 0.5, 0.6);
        namaste = windowed(g.t, LAY_RELEASE_S + 0.4, length, 0.4);
      } else if (g.kind === "charanamrit") {
        cup = windowed(g.t, 0, 1.6, 0.4);
        sip = windowed(g.t, 1.3, 2.3, 0.3);
        overHead = windowed(g.t, 2.1, length, 0.4);
      } else bell = envelope(g.t, length, 0.2, 0.25);
    }
    const palms = Math.max(namaste, pranam);

    const s = ease(this.sitBlend);
    // Walking legs keep their stride during a gesture; only the arm swing gives way to it.
    const w = this.walkAmount * (1 - s);
    const wArms = w * (1 - palms);
    const phase = (travelled / CYCLE_M) * Math.PI * 2;
    const breath = Math.sin(this.time * 1.3) * 0.012;
    const { hips, spine, head, ul, fl, ur, fr, tl, sl, tr, sr } = this;

    // Hips drop onto the mat (or the bench) when seated; a small bob while walking.
    const bench = this.onBench;
    hips.position.y = lerp(
      HIP_HEIGHT - Math.abs(Math.cos(phase)) * 0.012 * w,
      bench ? BENCH_HIP : SEATED_HIP,
      s,
    );
    hips.position.z = bench ? -BENCH_BACK * s : 0;
    // A standing bow leans forward from the hips; seated, only the head bows.
    const bow = pranam * (1 - s);
    spine.rotation.set(
      breath +
        0.42 * bow +
        0.12 * pranam * s +
        0.22 * wash +
        0.16 * whisper +
        0.1 * pour +
        0.4 * reach +
        0.12 * cup +
        0.08 * overHead,
      Math.sin(phase) * 0.06 * w,
      0,
    );
    // Namaste: a slight nod in the middle of the gesture.
    const nodT =
      g?.kind === "whisper"
        ? Math.max(0, gt - WHISPER_LEAN_S) / (WHISPER_S - WHISPER_LEAN_S)
        : gt / GESTURE_S.namaste;
    const nod = namaste * Math.sin(Math.min(1, nodT) * Math.PI);
    // Whispering: the head lifts a little towards Nandi's ear and tilts to the cupped hand.
    head.rotation.x = lerp(0.02, 0.08, s) + 0.2 * nod + 0.2 * pranam + 0.15 * wash - 0.12 * whisper;
    head.rotation.z = -0.1 * whisper;
    this.skirt.scale.y = lerp(1, bench ? 0.6 : 0.35, s);

    // Legs. Standing: swing with the stride. Seated: thighs forward and out, shins crossed (left
    // over right), feet lying along the shins with the soles down, never towards the sanctum.
    const swing = Math.sin(phase) * SWING * w;
    const kneeL = Math.max(0, Math.cos(phase)) * 0.75 * w;
    const kneeR = Math.max(0, -Math.cos(phase)) * 0.75 * w;
    // On a bench: thighs along the seat, a little apart, shins straight down, feet flat on the
    // ground with the soles down (spec 03 § Sit on a bench).
    if (bench) {
      tl.rotation.set(lerp(-swing, -1.45, s), lerp(0, 0.12, s), 0);
      tr.rotation.set(lerp(swing, -1.45, s), lerp(0, -0.12, s), 0);
      sl.rotation.set(lerp(kneeL, 1.45, s), 0, 0);
      sr.rotation.set(lerp(kneeR, 1.45, s), 0, 0);
    } else {
      tl.rotation.set(lerp(-swing, -1.36, s), lerp(0, 0.95, s), 0);
      tr.rotation.set(lerp(swing, -1.36, s), lerp(0, -0.95, s), 0);
      sl.rotation.set(lerp(kneeL, -0.15, s), 0, lerp(0, -2.3, s));
      sr.rotation.set(lerp(kneeR, 0.12, s), 0, lerp(0, 2.3, s));
    }
    this.footL.rotation.x = bench ? 0 : lerp(0, 1.4, s);
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
    // Washing: both hands forward and cupped together under the spout, rubbed slowly while the
    // water runs, then a gentle shake at the end. Calm, never a splash.
    if (wash > 0) {
      const u = gt / WASH_S;
      const rub = u > 0.2 && u < 0.78 ? Math.sin(gt * Math.PI * 2 * 1.6) * 0.1 : 0;
      const shake = u >= 0.78 ? Math.sin(gt * Math.PI * 2 * 3) * 0.08 * wash : 0;
      ulx = lerp(ulx, -0.95, wash);
      urx = lerp(urx, -0.95, wash);
      ulz = lerp(ulz, -0.28, wash);
      urz = lerp(urz, 0.28, wash);
      flx = lerp(flx, -0.5 + shake, wash);
      frx = lerp(frx, -0.5 - shake, wash);
      flz = lerp(flz, -0.35 + rub, wash);
      frz = lerp(frz, 0.35 + rub, wash);
    }
    // Whispering: the right hand cupped beside the mouth, the left resting at the chest. Still and
    // quiet; the hand never reaches out to touch Nandi.
    if (whisper > 0) {
      const N = NAMASTE_POSE;
      urx = lerp(urx, -1.15, whisper);
      urz = lerp(urz, 0.02, whisper);
      frx = lerp(frx, -1.55, whisper);
      frz = lerp(frz, 0.75, whisper);
      ulx = lerp(ulx, N.upper[0], whisper);
      ulz = lerp(ulz, N.upper[1], whisper);
      flx = lerp(flx, N.fore[0], whisper);
      flz = lerp(flz, N.fore[1] + this.body.palmsOut, whisper);
    }
    // Pouring: both hands round the lota in front of the chest, raised a little as it tips.
    if (pour > 0) {
      const up = 0.15 * tilt;
      ulx = lerp(ulx, -1.0 - up, pour);
      urx = lerp(urx, -1.0 - up, pour);
      ulz = lerp(ulz, -0.3, pour);
      urz = lerp(urz, 0.3, pour);
      flx = lerp(flx, -0.75, pour);
      frx = lerp(frx, -0.75, pour);
      flz = lerp(flz, -0.45, pour);
      frz = lerp(frz, 0.45, pour);
    }
    // Laying a leaf or flower: held together at the chest, then reached forward onto the linga.
    if (hold > 0) {
      const ux = lerp(-0.8, -0.55, reach);
      const fx = lerp(-1.0, -0.25, reach);
      ulx = lerp(ulx, ux, hold);
      urx = lerp(urx, ux, hold);
      ulz = lerp(ulz, -0.3, hold);
      urz = lerp(urz, 0.3, hold);
      flx = lerp(flx, fx, hold);
      frx = lerp(frx, fx, hold);
      flz = lerp(flz, -0.5, hold);
      frz = lerp(frz, 0.5, hold);
    }
    // Charanamrit: cupped hands receive the drops, are raised to the lips, then the right hand
    // passes lightly over the head while the left lowers.
    if (cup > 0 || sip > 0) {
      const w = Math.max(cup, sip);
      const ux = lerp(-0.95, -1.2, sip);
      const fx = lerp(-0.5, -1.5, sip);
      const fz = lerp(0.35, 0.6, sip);
      ulx = lerp(ulx, ux, w);
      urx = lerp(urx, ux, w);
      ulz = lerp(ulz, -0.28, w);
      urz = lerp(urz, 0.28, w);
      flx = lerp(flx, fx, w);
      frx = lerp(frx, fx, w);
      flz = lerp(flz, -fz, w);
      frz = lerp(frz, fz, w);
    }
    if (overHead > 0) {
      urx = lerp(urx, -2.55, overHead);
      urz = lerp(urz, 0.25, overHead);
      frx = lerp(frx, -1.25, overHead);
      frz = lerp(frz, 0.7, overHead);
    }
    ul.rotation.set(ulx, 0, ulz);
    ur.rotation.set(urx, 0, urz);
    fl.rotation.set(flx, 0, flz);
    fr.rotation.set(frx, 0, frz);
    this.hl.rotation.set(wx, wy, wz);
    this.hr.rotation.set(wx, -wy, -wz);
    this.rootBone.updateMatrixWorld(true);
    this.poseDirty = true;
    this.updateProps(g?.kind ?? null, gt, tilt);
  }

  /** The lota, leaf or flower between the hands, while one is in use. */
  private updateProps(kind: GestureAnim | null, t: number, tilt: number): void {
    const showLota = kind === "pour";
    const showItem = (kind === "bilva" || kind === "flower") && t < LAY_RELEASE_S;
    if (!showLota && !showItem) {
      if (this.props) this.props.group.visible = false;
      return;
    }
    if (!this.props) {
      this.props = makeProps();
      this.root.add(this.props.group);
    }
    const pr = this.props;
    // Midway between the hands, in the avatar's own space (it faces +z).
    // The bones were just updated under the root; only the root's own matrix may be stale.
    this.root.updateWorldMatrix(true, false);
    this.rootBone.updateMatrixWorld(true);
    handL.setFromMatrixPosition(this.hl.matrixWorld);
    handR.setFromMatrixPosition(this.hr.matrixWorld);
    this.root.worldToLocal(handL);
    this.root.worldToLocal(handR);
    handL.add(handR).multiplyScalar(0.5);
    pr.group.visible = true;
    pr.group.position.copy(handL);
    pr.group.scale.setScalar(1 / this.root.scale.x);
    pr.lota.visible = showLota;
    pr.stream.visible = showLota && tilt > 0.6;
    pr.leaf.visible = showItem && kind === "bilva";
    pr.flower.visible = showItem && kind === "flower";
    // In the sanctum, the offering goes onto the linga: the target in the props' own space,
    // which is in metres and turned with the avatar.
    const offering = this.root.position.distanceTo(OFFER_TARGET) < OFFER_NEAR_M;
    if (offering) {
      toTarget.copy(OFFER_TARGET);
      this.root.worldToLocal(toTarget).sub(handL).multiplyScalar(this.root.scale.x);
    }
    if (showLota) {
      // Held by its belly, tipped forward (towards +z) as the water pours.
      pr.lota.position.set(0, -0.05, 0.05);
      pr.lota.rotation.set(1.25 * tilt, 0, 0);
      lip.set(0, -0.02, 0.17);
      if (offering) {
        // A thin stream from the lip onto the top of the linga.
        toTarget.sub(lip);
        const len = Math.max(0.05, toTarget.length());
        pr.stream.scale.set(1, len, 1);
        pr.stream.quaternion.setFromUnitVectors(DOWN, toTarget.normalize());
        pr.stream.position.copy(lip).addScaledVector(toTarget, len / 2);
      } else {
        // A thin stream from the lip down towards the floor in front.
        const len = 0.55;
        pr.stream.scale.set(1, len, 1);
        pr.stream.quaternion.identity();
        pr.stream.position.set(0, -0.02 - len / 2, 0.17);
      }
    }
    if (showItem) {
      // Held between the hands, then carried gently onto the linga as the hands reach out.
      const k = offering ? smooth01((t - (LAY_RELEASE_S - LAY_CARRY_S)) / LAY_CARRY_S) : 0;
      for (const item of [pr.leaf, pr.flower]) {
        item.position.set(0, 0.01, 0.04);
        if (k > 0) item.position.lerp(toTarget, k);
      }
    }
  }

  dispose(): void {
    // Geometry and material are shared (disposeAvatarCache); the skeleton's bone texture is not.
    this.mesh.skeleton.dispose();
    this.root.removeFromParent();
    live.delete(this);
  }
}
