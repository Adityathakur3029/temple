/**
 * Models in asset slots (spec 11 § Slots): loads each built model listed in the asset manifest,
 * by priority (spec 10 § Loading priority), and puts it in place of its greybox shape. A model
 * that fails to load leaves the greybox shape, so the temple always works.
 *
 * Until the lighting pass (M5) adds an environment map, models use the greybox's matte
 * (Lambert) lighting, which also keeps them cheap on Low phones.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  type InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import manifestJson from "../assets/manifest.json";
import type { AssetManifest, AssetTier, ManifestFile } from "../assets/manifest";
import { PRIORITIES, SLOTS, isSlotId, type SlotId } from "../assets/slots";
import type { Greybox } from "./greybox";

export const MANIFEST = manifestJson as AssetManifest;

/** How long the boot screen waits for the first-view (P0) models before opening anyway. */
export const FIRST_VIEW_WAIT_MS = 5000;

export type SlotStatus = "loading" | "ready" | "failed";

/** The asset origin is set at build time (spec 01); empty means the app's own origin. */
export function assetUrl(path: string, origin = import.meta.env.VITE_ASSET_ORIGIN): string {
  return `${(origin ?? "").trim().replace(/\/+$/, "")}${path}`;
}

/** The manifest's files for one tier, grouped by priority, slots in a known order. */
export function filesByPriority(manifest: AssetManifest, tier: AssetTier): ManifestFile[][] {
  return PRIORITIES.map((p) =>
    manifest.files.filter((f) => f.tier === tier && f.priority === p && isSlotId(f.slot)),
  ).filter((group) => group.length > 0);
}

type ColourMaps = Partial<Record<"map" | "emissiveMap" | "alphaMap", Texture | null>>;

function disposeMaterial(m: Material): void {
  const maps = m as Material & ColourMaps;
  maps.map?.dispose();
  maps.emissiveMap?.dispose();
  maps.alphaMap?.dispose();
  m.dispose();
}

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    (o.geometry as BufferGeometry).dispose();
    const mats = o.material as Material | Material[];
    for (const m of Array.isArray(mats) ? mats : [mats]) disposeMaterial(m);
  });
}

/** The glTF PBR material as the greybox's matte material, keeping its colour textures. */
export function toMatte(m: Material): Material {
  if (m instanceof MeshBasicMaterial || !(m instanceof MeshStandardMaterial)) return m;
  const matte = new MeshLambertMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    emissiveIntensity: m.emissiveIntensity,
    alphaMap: m.alphaMap,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side,
    // A transparent double-sided material would otherwise cost two draw calls (spec 10).
    forceSinglePass: m.forceSinglePass || (m.transparent && m.side === DoubleSide),
    vertexColors: m.vertexColors,
    flatShading: m.flatShading,
    depthWrite: m.depthWrite,
  });
  m.dispose(); // its textures now belong to the matte material
  return matte;
}

function matteAll(root: Object3D): void {
  const done = new Map<Material, Material>();
  const swap = (m: Material): Material => {
    let out = done.get(m);
    if (!out) {
      out = toMatte(m);
      done.set(m, out);
    }
    return out;
  };
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = o.material as Material | Material[];
    o.material = Array.isArray(mats) ? mats.map(swap) : swap(mats);
  });
}

/** Float, non-interleaved copy of an attribute (built models are quantised). */
function floatAttribute(attr: BufferGeometry["attributes"][string]): BufferAttribute {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  return new BufferAttribute(out, attr.itemSize);
}

/**
 * One geometry (a group per material) and its materials, for an instanced slot: every mesh in
 * the model, in the model's own frame.
 */
export function mergeForInstancing(root: Object3D): {
  geometry: BufferGeometry;
  materials: Material[];
} {
  root.updateMatrixWorld(true);
  const parts: { geometry: BufferGeometry; material: Material }[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const src = o.geometry as BufferGeometry;
    const g = new BufferGeometry();
    for (const name of ["position", "normal", "uv", "color"]) {
      const a = src.getAttribute(name);
      if (a) g.setAttribute(name, floatAttribute(a));
    }
    const index = src.getIndex();
    if (index) g.setIndex(Array.from(index.array));
    g.applyMatrix4(o.matrixWorld);
    const mats = o.material as Material | Material[];
    parts.push({ geometry: g, material: Array.isArray(mats) ? (mats[0] as Material) : mats });
  });
  if (parts.length === 0) throw new Error("the model has no meshes");
  // mergeGeometries needs the same attributes everywhere: fill in what a part lacks.
  const has = (name: string): boolean => parts.some((p) => p.geometry.getAttribute(name));
  const indexed = parts.every((p) => p.geometry.getIndex());
  for (const p of parts) {
    if (!indexed && p.geometry.getIndex()) p.geometry = p.geometry.toNonIndexed();
    const n = p.geometry.getAttribute("position").count;
    if (!p.geometry.getAttribute("normal")) p.geometry.computeVertexNormals();
    if (has("uv") && !p.geometry.getAttribute("uv")) {
      p.geometry.setAttribute("uv", new BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (has("color") && !p.geometry.getAttribute("color")) {
      p.geometry.setAttribute("color", new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
  }
  const geometry = mergeGeometries(
    parts.map((p) => p.geometry),
    true,
  );
  for (const p of parts) p.geometry.dispose();
  if (!geometry) throw new Error("the model's meshes can't be merged");
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, materials: parts.map((p) => p.material) };
}

interface Loaders {
  gltf: GLTFLoader;
  dispose(): void;
}

async function makeLoaders(
  renderer: WebGLRenderer,
  workers: number,
  textured: boolean,
): Promise<Loaders> {
  const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/KTX2Loader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);
  // With no transcoder path, KTX2Loader finds the Basis transcoder next to itself; Vite emits
  // it with the app build (hashed), so it isn't an asset. Few workers: each holds a copy.
  const ktx2 = new KTX2Loader().setWorkerLimit(workers).detectSupport(renderer);
  // Fetch the transcoder alongside the first model instead of after it.
  if (textured) void ktx2.init();
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  return { gltf, dispose: () => ktx2.dispose() };
}

export interface ModelsOptions {
  renderer: WebGLRenderer;
  greybox: Greybox;
  /** Where single-slot models are added. */
  parent: Object3D;
  tier: AssetTier;
  manifest?: AssetManifest;
  /** Texture transcoding workers (1 on Low phones). */
  workers?: number;
  /** Compiles shaders and uploads textures for a model before it is shown, to avoid a stall. */
  prepare?: (model: Object3D) => Promise<void>;
  /** Called with the meshes of each single-slot model put in place, for shadows. */
  onPlaced?: (meshes: Mesh[]) => void;
  /** Called after any model is put in place. */
  onChange?: () => void;
}

export class SceneModels {
  private readonly manifest: AssetManifest;
  private readonly placed = new Map<SlotId, { root: Group; meshes: Mesh[] }>();
  private readonly state = new Map<SlotId, SlotStatus>();
  /** Slots showing a model (from either tier). */
  private readonly shown = new Set<SlotId>();
  private loaders: Promise<Loaders> | null = null;
  private generation = 0;
  private tier: AssetTier;
  private disposed = false;
  /** Settles when the first-view (P0) models are in place or have failed. */
  firstView: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ModelsOptions) {
    this.manifest = opts.manifest ?? MANIFEST;
    this.tier = opts.tier;
  }

  /** Starts loading every model for the current tier, highest priority first. */
  start(): Promise<void> {
    const gen = ++this.generation;
    const groups = filesByPriority(this.manifest, this.tier);
    for (const group of groups) for (const f of group) this.state.set(f.slot, "loading");
    let signalFirst: () => void = () => undefined;
    this.firstView = new Promise<void>((resolve) => (signalFirst = resolve));
    const run = async (): Promise<void> => {
      for (const [i, group] of groups.entries()) {
        await Promise.all(group.map((f) => this.load(f, gen)));
        if (i === 0) signalFirst();
        if (gen !== this.generation) return;
      }
      // Everything is loaded: free the decoders and their workers until a tier change.
      this.releaseLoaders();
    };
    void run().finally(() => signalFirst());
    if (groups.length === 0 || groups[0]?.[0]?.priority !== "P0") signalFirst();
    return this.firstView;
  }

  /** Lite mode uses the Lite files; models already in place stay until their swap arrives. */
  setTier(tier: AssetTier): void {
    if (tier === this.tier || this.disposed) return;
    this.tier = tier;
    if (this.manifest.files.length > 0) void this.start();
  }

  private releaseLoaders(): void {
    const loaders = this.loaders;
    this.loaders = null;
    void loaders?.then((l) => l.dispose());
  }

  status(): Partial<Record<SlotId, SlotStatus>> {
    return Object.fromEntries(this.state);
  }

  /** Every mesh of the placed single-slot models, for shadows. */
  meshes(): Mesh[] {
    return [...this.placed.values()].flatMap((p) => p.meshes);
  }

  private instancedTarget(slot: SlotId): InstancedMesh | null {
    const g = this.opts.greybox;
    const map: Partial<Record<SlotId, InstancedMesh>> = {
      bell: g.bells,
      mat: g.mats,
      tree: g.trees,
      footwear: g.footwear,
    };
    return map[slot] ?? null;
  }

  private async load(file: ManifestFile, gen: number): Promise<void> {
    const slot = file.slot;
    try {
      this.loaders ??= makeLoaders(
        this.opts.renderer,
        this.opts.workers ?? 2,
        this.manifest.files.some((f) => f.textures.length > 0),
      );
      const loaders = await this.loaders;
      const gltf = await loaders.gltf.loadAsync(assetUrl(file.path));
      if (gen !== this.generation || this.disposed) {
        disposeTree(gltf.scene);
        return;
      }
      matteAll(gltf.scene);
      const single = SLOTS[slot].kind === "single";
      if (single) await this.opts.prepare?.(gltf.scene);
      if (gen !== this.generation || this.disposed) {
        disposeTree(gltf.scene);
        return;
      }
      if (single) this.placeSingle(slot, gltf.scene);
      else this.placeInstanced(slot, gltf.scene);
      this.shown.add(slot);
      this.state.set(slot, "ready");
      this.opts.onChange?.();
    } catch (err) {
      if (gen !== this.generation) return;
      // A model in place from the other tier stays; otherwise the greybox shape does.
      this.state.set(slot, this.shown.has(slot) ? "ready" : "failed");
      console.warn(`The ${slot} model didn't load; keeping what is shown now.`, err);
    }
  }

  private placeSingle(slot: SlotId, model: Object3D): void {
    const place = SLOTS[slot].place;
    if (!place) throw new Error(`slot ${slot} has no place`);
    const root = new Group();
    root.name = `slot:${slot}`;
    root.position.set(place.x, place.y, place.z);
    root.rotation.y = place.yaw;
    root.add(model);
    root.updateMatrixWorld(true);
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      o.matrixAutoUpdate = false; // static (spec 10 § Frame loop hygiene)
      if (o instanceof Mesh) meshes.push(o as Mesh);
    });
    const previous = this.placed.get(slot);
    if (previous) {
      previous.root.removeFromParent();
      disposeTree(previous.root);
    }
    this.opts.parent.add(root);
    this.placed.set(slot, { root, meshes });
    this.opts.greybox.hide(slot);
    this.opts.onPlaced?.(meshes);
  }

  private placeInstanced(slot: SlotId, model: Object3D): void {
    const target = this.instancedTarget(slot);
    if (!target) throw new Error(`slot ${slot} has no instanced mesh`);
    const { geometry, materials } = mergeForInstancing(model);
    // The materials move to the instanced mesh; the model's own geometries are no longer needed.
    model.traverse((o) => {
      if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
    });
    target.geometry.dispose();
    const old = target.material;
    for (const m of Array.isArray(old) ? old : [old]) disposeMaterial(m);
    target.geometry = geometry;
    target.material = materials.length === 1 ? (materials[0] as Material) : materials;
    // Bounds are cached; a stale sphere could cull the whole mesh.
    target.boundingSphere = null;
    target.boundingBox = null;
    // The instanced mesh is the same object, so its shadow settings already apply.
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const p of this.placed.values()) {
      p.root.removeFromParent();
      disposeTree(p.root);
    }
    this.placed.clear();
    this.releaseLoaders();
  }
}
