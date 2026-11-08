/**
 * Builds one slot's model (spec 11 § Pipeline): clean it, turn and fit it to the slot, join and
 * simplify it to the slot's budgets, then write a Full and a Lite GLB with meshopt geometry and
 * KTX2 (ETC1S) textures sized for each tier.
 *
 * Until the lighting pass (M5) adds an environment map, the client draws models with the same
 * matte lighting as the greybox, so only colour textures (base colour, emissive) are kept.
 */
import {
  Logger,
  NodeIO,
  Primitive,
  type Document,
  type Texture,
  type mat4,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import {
  cloneDocument,
  convertPrimitiveToTriangles,
  dedup,
  flatten,
  getBounds,
  getGLPrimitiveCount,
  join,
  meshopt,
  normals,
  palette,
  prune,
  simplify,
  transformMesh,
  uninstance,
  weld,
} from "@gltf-transform/functions";
import { encodeToKTX2 } from "ktx2-encoder";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import type { AssetTier } from "../../apps/web/src/assets/manifest";
import {
  AVATAR_LOW_TRIANGLES,
  SLOTS,
  liteTriangleTarget,
  type SlotId,
} from "../../apps/web/src/assets/slots";
import type { SlotConfig, Vec3 } from "./config";
import { fitMatrix, IDENTITY, rotationXYZ, type Bounds, type Mat4 } from "./fit";

/** Extensions a built model may keep; everything else is removed. */
const KEEP_EXTENSIONS = new Set([
  "KHR_texture_basisu",
  "EXT_meshopt_compression",
  "KHR_mesh_quantization",
  "KHR_texture_transform",
  "KHR_materials_emissive_strength",
  "KHR_materials_unlit",
]);

/** ETC1S settings: the quality/size balance for colour textures. */
const ETC1S = { qualityLevel: 128, compressionLevel: 2 } as const;

export interface BuiltTier {
  bytes: Uint8Array;
  triangles: number;
  /** Width and height of each texture. */
  textures: [number, number][];
}

export interface BuiltSlot {
  tiers: Record<AssetTier, BuiltTier>;
  draws: number;
  /** Bounds after fitting, in the model's own frame (front = +z). */
  bounds: Bounds;
  notes: string[];
}

let io: NodeIO | null = null;

export async function makeIO(): Promise<NodeIO> {
  if (io) return io;
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  io = new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
  return io;
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) n += getGLPrimitiveCount(prim);
  }
  return n;
}

export function countDraws(doc: Document): number {
  let n = 0;
  for (const node of doc.getRoot().listNodes()) n += node.getMesh()?.listPrimitives().length ?? 0;
  return n;
}

function sceneBounds(doc: Document): Bounds {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("the file has no scene");
  const b = getBounds(scene);
  return { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]] };
}

/** Removes everything a static slot model can't use: animation, rigs, cameras, lights, lines. */
function strip(doc: Document, notes: string[]): void {
  const root = doc.getRoot();
  if (root.listAnimations().length > 0) notes.push("animations removed");
  for (const a of root.listAnimations()) a.dispose();
  for (const node of root.listNodes()) {
    node.setSkin(null);
    node.setCamera(null);
  }
  for (const s of root.listSkins()) s.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const mesh of root.listMeshes()) {
    mesh.setWeights([]);
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) {
        prim.removeTarget(t);
        t.dispose();
      }
      for (const semantic of prim.listSemantics()) {
        if (/^(JOINTS|WEIGHTS)_/.test(semantic)) prim.setAttribute(semantic, null);
      }
      const mode = prim.getMode();
      if (mode === Primitive.Mode.TRIANGLE_STRIP || mode === Primitive.Mode.TRIANGLE_FAN) {
        convertPrimitiveToTriangles(prim);
      } else if (mode !== Primitive.Mode.TRIANGLES) {
        prim.dispose();
      }
    }
  }
}

/** Keeps colour textures only (see the file comment) and removes unsupported extensions. */
function keepColourOnly(doc: Document): void {
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null);
    m.setOcclusionTexture(null);
    m.setMetallicRoughnessTexture(null);
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (!KEEP_EXTENSIONS.has(ext.extensionName)) ext.dispose();
  }
}

/** Gives every node its own mesh, then bakes each node's transform into the vertices. */
function bakeTransforms(doc: Document): void {
  const seen = new Set<object>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (seen.has(mesh)) node.setMesh(mesh.clone());
    seen.add(node.getMesh() as object);
  }
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh) transformMesh(mesh, node.getWorldMatrix());
  }
  for (const node of doc.getRoot().listNodes()) {
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
}

function transformAll(doc: Document, m: Mat4): void {
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m as unknown as mat4);
}

/** The power of two at or below n, or the next one up when n is within 10% of it. */
function powerOfTwo(n: number): number {
  const below = 2 ** Math.floor(Math.log2(Math.max(1, n)));
  return n >= below * 2 * 0.9 ? below * 2 : below;
}

/** A power-of-two size for each side, capped at `max`; never a blurry upscale. */
export function textureSize(w: number, h: number, max: number): [number, number] {
  return [Math.min(max, powerOfTwo(w)), Math.min(max, powerOfTwo(h))];
}

/** GPU memory for textures with mipmaps (a third more), at 8 bits per pixel. */
export function gpuBytes(textures: readonly [number, number][]): number {
  return Math.round(textures.reduce((n, [w, h]) => n + w * h, 0) * (4 / 3));
}

/** The basis encoder prints progress to stdout; keep the build output readable. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

async function decode(
  buffer: Uint8Array,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function encodeTexture(tex: Texture, max: number): Promise<[number, number] | null> {
  const image = tex.getImage();
  if (!image) return null;
  if (tex.getMimeType() === "image/ktx2") {
    throw new Error("its textures are already KTX2; download the PNG or JPEG version instead");
  }
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error(`texture "${tex.getName()}" can't be read`);
  const [w, h] = textureSize(meta.width, meta.height, max);
  const png = await sharp(image).resize(w, h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const ktx2 = await quietly(() =>
    encodeToKTX2(new Uint8Array(png), {
      isUASTC: false,
      generateMipmap: true,
      isKTX2File: true,
      isPerceptual: true,
      isSetKTX2SRGBTransferFunc: true,
      enableDebug: false,
      ...ETC1S,
      imageDecoder: decode,
    }),
  );
  tex.setImage(ktx2).setMimeType("image/ktx2");
  tex.setURI(tex.getURI() ? tex.getURI().replace(/\.[a-z0-9]+$/i, "") + ".ktx2" : "");
  return [w, h];
}

async function encodeTextures(doc: Document, max: number): Promise<[number, number][]> {
  const textures = doc.getRoot().listTextures();
  if (textures.length === 0) return [];
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const sizes: [number, number][] = [];
  for (const tex of textures) {
    const size = await encodeTexture(tex, max);
    if (size) sizes.push(size);
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === "EXT_texture_webp" || ext.extensionName === "EXT_texture_avif") {
      ext.dispose();
    }
  }
  return sizes;
}

/** Simplifies until the model fits its triangle budget, allowing a little more error each time. */
/** Error steps, as a fraction of the mesh radius. Lite, for Low phones, may go a little further. */
const ERRORS = { full: [0.001, 0.004, 0.01, 0.02, 0.05], lite: [0.01, 0.02, 0.05, 0.08, 0.12] };

async function simplifyTo(
  doc: Document,
  budget: number,
  errors: readonly number[] = ERRORS.full,
): Promise<number> {
  let tris = countTriangles(doc);
  for (const error of errors) {
    if (tris <= budget) break;
    const ratio = Math.min(1, (budget / tris) * 0.95);
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
    tris = countTriangles(doc);
  }
  return tris;
}

/** The meshes scene/avatar.ts looks for in the avatar file: two bodies, near and far detail. */
export const RIG_MESHES = ["body0-high", "body0-low", "body1-high", "body1-low"] as const;

/**
 * The avatar (a `rig` slot): kept as made, with its skin, because the code poses it bone by bone.
 * Only animations, cameras and non-colour textures go; nothing is fitted, joined or simplified.
 * The triangle count reported is the near detail; the far detail has its own limit.
 */
async function buildRig(slot: SlotId, cfg: SlotConfig, doc: Document): Promise<BuiltSlot> {
  const spec = SLOTS[slot];
  const notes: string[] = [];
  if (cfg.fit !== "none") throw new Error('a rig is used as made: set "fit": "none"');
  const root = doc.getRoot();
  if (root.listSkins().length === 0) throw new Error("it has no skin; the avatar must be rigged");
  if (root.listAnimations().length > 0) notes.push("animations removed (the code animates it)");
  for (const a of root.listAnimations()) a.dispose();
  for (const node of root.listNodes()) node.setCamera(null);
  for (const c of root.listCameras()) c.dispose();
  keepColourOnly(doc);
  await doc.transform(prune({ keepLeaves: true }), dedup());

  const tris = new Map<string, number>();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let n = 0;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
        throw new Error(`mesh ${node.getName()} has lines or strips; export triangles only`);
      }
      n += getGLPrimitiveCount(prim);
    }
    tris.set(node.getName(), n);
  }
  const missing = RIG_MESHES.filter((name) => !tris.has(name));
  if (missing.length > 0) throw new Error(`no mesh named ${missing.join(", ")}`);
  const high = Math.max(tris.get("body0-high") ?? 0, tris.get("body1-high") ?? 0);
  const low = Math.max(tris.get("body0-low") ?? 0, tris.get("body1-low") ?? 0);
  if (high > spec.maxTriangles) {
    throw new Error(`${high} triangles near up close; the slot allows ${spec.maxTriangles}`);
  }
  if (low > AVATAR_LOW_TRIANGLES) {
    throw new Error(`${low} triangles at a distance; the slot allows ${AVATAR_LOW_TRIANGLES}`);
  }
  notes.push(`at a distance ${low.toLocaleString("en")} triangles`);
  const bounds = sceneBounds(doc);
  notes.push(
    `size ${round(bounds.max.map((v, i) => v - (bounds.min[i] ?? 0)) as Vec3).join(" × ")} m`,
  );

  const docs = { full: doc, lite: cloneDocument(doc) };
  const nodeIO = await makeIO();
  const tiers = {} as Record<AssetTier, BuiltTier>;
  for (const tier of ["full", "lite"] as const) {
    const out = docs[tier];
    const textures = await encodeTextures(out, spec.texture[tier]);
    await out.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    tiers[tier] = { bytes: await nodeIO.writeBinary(out), triangles: high, textures };
  }
  return { tiers, draws: 1, bounds, notes };
}

function round(v: Vec3): Vec3 {
  return v.map((n) => Math.round(n * 1000) / 1000) as Vec3;
}

export async function buildSlot(
  slot: SlotId,
  cfg: SlotConfig,
  sourcePath: string,
): Promise<BuiltSlot> {
  const spec = SLOTS[slot];
  const notes: string[] = [];
  const nodeIO = await makeIO();
  let doc: Document;
  try {
    doc = await nodeIO.read(sourcePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/draco/i.test(msg)) {
      throw new Error("it uses Draco compression; download an uncompressed GLB or glTF instead", {
        cause: err,
      });
    }
    throw new Error(`can't read the file: ${msg}`, { cause: err });
  }
  if (spec.kind === "rig") return buildRig(slot, cfg, doc);

  strip(doc, notes);
  await doc.transform(uninstance(), flatten());
  bakeTransforms(doc);
  const turn = rotationXYZ(cfg.rotate);
  if (turn.some((v, i) => v !== IDENTITY[i])) transformAll(doc, turn);
  const fit = fitMatrix(sceneBounds(doc), spec, cfg);
  transformAll(doc, fit.matrix);
  if (fit.scale !== 1) notes.push(`scaled ×${fit.scale.toPrecision(3)}`);

  await doc.transform(dedup(), palette({ min: 2 }));
  keepColourOnly(doc);
  await doc.transform(prune(), dedup(), join(), weld());

  // Simplify before adding any missing normals: flat normals split every vertex, and a mesh
  // of disconnected triangles can't be simplified.
  const before = countTriangles(doc);
  const triangles = before > spec.maxTriangles ? await simplifyTo(doc, spec.maxTriangles) : before;
  if (triangles !== before) {
    notes.push(`simplified from ${before.toLocaleString("en")} triangles`);
  }
  if (triangles > spec.maxTriangles) {
    throw new Error(
      `${triangles.toLocaleString("en")} triangles after simplifying; the slot allows ${spec.maxTriangles.toLocaleString("en")}`,
    );
  }
  if (triangles === 0) throw new Error("no triangles left (is the file empty?)");

  // Lite goes to Low phones: aim for half the triangles (sacred forms keep their detail).
  // Like the full tier, it is simplified before normals are added.
  const lite = cloneDocument(doc);
  let liteTriangles = triangles;
  const target = liteTriangleTarget(spec);
  if (triangles > target) {
    liteTriangles = await simplifyTo(lite, target, ERRORS.lite);
    notes.push(`Lite: ${liteTriangles.toLocaleString("en")} triangles`);
  }
  const docs = { full: doc, lite };
  for (const d of [doc, lite]) {
    const lacksNormals = d
      .getRoot()
      .listMeshes()
      .some((m) => m.listPrimitives().some((p) => !p.getAttribute("NORMAL")));
    // normals() unwelds the whole document, so weld afterwards.
    if (lacksNormals) await d.transform(normals({ overwrite: false }), weld());
    await d.transform(prune());
  }

  const draws = countDraws(doc);
  if (draws > spec.maxDraws) {
    throw new Error(
      `${draws} materials (draw calls); the slot allows ${spec.maxDraws}. ` +
        "An artist can merge them into one texture atlas.",
    );
  }
  const bounds = sceneBounds(doc);
  notes.push(
    `size ${round(bounds.max.map((v, i) => v - (bounds.min[i] ?? 0)) as Vec3).join(" × ")} m`,
  );

  const tiers = {} as Record<AssetTier, BuiltTier>;
  for (const tier of ["full", "lite"] as const) {
    const out = docs[tier];
    const textures = await encodeTextures(out, spec.texture[tier]);
    await out.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const tris = tier === "full" ? triangles : liteTriangles;
    tiers[tier] = { bytes: await nodeIO.writeBinary(out), triangles: tris, textures };
  }
  return { tiers, draws, bounds, notes };
}
