import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import type { AssetManifest, ManifestFile } from "../src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../src/assets/slots";
import { MeshBuilder, withoutSection } from "../src/scene/builder";
import { GANESHA_SHRINE, TODAY_BOARD } from "@sannidhi/protocol";
import {
  GATE_WALLS,
  MAX_TREES,
  POST_LAMP_OUT,
  TREE_SPREAD,
  buildGreybox,
  pathPosts,
} from "../src/scene/greybox";
import { assetUrl, filesByPriority, mergeForInstancing, toMatte } from "../src/scene/models";
import { BODY_RADIUS, isClear } from "../src/scene/nav";

describe("greybox sections", () => {
  it("cuts one section out and moves the others", () => {
    const b = new MeshBuilder();
    b.box(0, 1, 0, 1, 0, 1, "#000"); // 30 vertices, no section
    b.section("a").box(0, 1, 0, 1, 0, 1, "#f00");
    b.section("b").box(0, 1, 0, 1, 0, 1, "#0f0");
    b.section("a").box(0, 1, 0, 1, 0, 1, "#f00");
    b.section(null).box(0, 1, 0, 1, 0, 1, "#000");
    const g = b.build();
    const runs = b.sections();
    const per = 30; // a ground box skips its bottom face: 5 faces × 6 vertices
    expect(runs.get("a")).toEqual([
      { start: per, count: per },
      { start: 3 * per, count: per },
    ]);
    const cut = withoutSection(g, runs, "a");
    expect(cut.getAttribute("position").count).toBe(3 * per);
    expect(runs.has("a")).toBe(false);
    expect(runs.get("b")).toEqual([{ start: per, count: per }]);
    // The "b" box is green and now right after the first box.
    expect(cut.getAttribute("color").getY(per)).toBe(1);
  });

  it("has a section for every single slot, and hide() removes it", () => {
    const grey = buildGreybox({ mode: "half-somasutra", trees: 10 });
    const singles = SLOT_IDS.filter((id) => SLOTS[id].kind === "single");
    expect([...grey.sections].sort()).toEqual([...singles].sort());
    const before = grey.ground.geometry.getAttribute("position").count;
    grey.hide("nandi");
    const after = grey.ground.geometry.getAttribute("position").count;
    expect(after).toBe(before - 3 * 36); // three free-standing boxes
    expect(grey.sections.has("nandi")).toBe(false);
    grey.hide("nandi"); // a second time does nothing
    expect(grey.ground.geometry.getAttribute("position").count).toBe(after);
    grey.dispose();
  });
});

describe("near trees", () => {
  it("shows the tier's near trees first, then the far trees, up to the total", () => {
    const grey = buildGreybox({ mode: "half-somasutra", trees: MAX_TREES });
    const near = SLOTS["near-tree"].copies;
    const far = SLOTS.tree.copies;
    expect((near?.full ?? 0) + (far?.full ?? 0)).toBe(MAX_TREES);
    expect(grey.nearTrees.count).toBe(near?.full);
    expect(grey.trees.count).toBe(far?.full);
    grey.setTrees(90, "lite");
    expect(grey.nearTrees.count).toBe(near?.lite);
    expect(grey.trees.count).toBe(far?.lite);
    expect(grey.nearTrees.count + grey.trees.count).toBe(90);
    grey.setTrees(10, "full"); // fewer than the near trees: no far trees at all
    expect([grey.nearTrees.count, grey.trees.count]).toEqual([10, 0]);
    grey.dispose();
  });

  it("are the trees closest to the paths, and don't reach over them", () => {
    const grey = buildGreybox({ mode: "half-somasutra", trees: MAX_TREES });
    const m = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    const spread = 2.6; // the greybox tree's radius, and half the near-tree slot's fitted width
    const gap = (mesh: InstancedMesh, i: number): number => {
      mesh.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      let d = Infinity;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
        for (let r = 0; r < 8 && d === Infinity; r += 0.05) {
          if (isClear(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 0)) d = r;
        }
      }
      return d - spread * scale.x;
    };
    const nearGaps = Array.from({ length: grey.nearTrees.count }, (_, i) => gap(grey.nearTrees, i));
    // No branch reaches more than 10 cm over a walkable edge.
    expect(Math.min(...nearGaps)).toBeGreaterThan(-0.1);
    grey.dispose();
  });
});

describe("the forest", () => {
  /** Every tree's trunk position and its scale across and up. */
  const forest = (): { x: number; z: number; w: number; h: number }[] => {
    const grey = buildGreybox({ mode: "half-somasutra", trees: MAX_TREES });
    const m = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    const trees = [grey.trees, grey.nearTrees].flatMap((mesh) =>
      Array.from({ length: mesh.count }, (_, i) => {
        mesh.getMatrixAt(i, m);
        m.decompose(pos, quat, scale);
        return { x: pos.x, z: pos.z, w: scale.x, h: scale.y };
      }),
    );
    grey.dispose();
    return trees;
  };
  const toRect = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) =>
    Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

  it("keeps its branches out of the Ganesha shrine, the gate walls, the bell posts and the board", () => {
    for (const t of forest()) {
      const reach = TREE_SPREAD * t.w;
      // The shrine stands against open forest: its roof overhangs its walls by 0.15 m.
      const shrine = toRect(GANESHA_SHRINE, t.x, t.z) - 0.15;
      expect(shrine).toBeGreaterThanOrEqual(Math.max(reach + 1, 3) - 1e-9);
      for (const wall of GATE_WALLS) expect(toRect(wall, t.x, t.z)).toBeGreaterThan(reach);
      for (const p of pathPosts()) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThan(reach);
      const board = Math.hypot(TODAY_BOARD.x - t.x, TODAY_BOARD.z - t.z) - 0.8;
      expect(board).toBeGreaterThan(reach);
    }
  });

  it("grows at mixed ages, with the old giants well back from the paths", () => {
    const trees = forest();
    expect(trees).toHaveLength(MAX_TREES);
    const heights = trees.map((t) => t.h);
    // Young trees under half the greybox tree's 10.4 m, and old ones over half again as tall.
    expect(Math.min(...heights)).toBeLessThan(0.5);
    expect(Math.max(...heights)).toBeGreaterThan(1.5);
    expect(trees.filter((t) => t.h < 0.7).length).toBeGreaterThan(MAX_TREES * 0.1);
    // Only the giants are wider than 1.25; none has walkable ground within 12 m.
    const giants = trees.filter((t) => t.w > 1.25);
    expect(giants.length).toBeGreaterThan(MAX_TREES * 0.05);
    for (const t of giants) {
      for (let dx = -12; dx <= 12; dx += 0.5) {
        for (let dz = -12; dz <= 12; dz += 0.5) {
          if (dx * dx + dz * dz <= 144) expect(isClear(t.x + dx, t.z + dz, 0)).toBe(false);
        }
      }
    }
  });
});

describe("path post lamps", () => {
  it("puts one lamp on each path post, as many as the post-lamp slot draws", () => {
    const posts = pathPosts();
    expect(posts).toHaveLength(8);
    expect(SLOTS["post-lamp"].copies).toEqual({ full: posts.length, lite: posts.length });
    const grey = buildGreybox({ mode: "half-somasutra", trees: 10 });
    expect(grey.postLamps.count).toBe(posts.length);
    const box = new Box3().setFromBufferAttribute(
      grey.postLamps.geometry.getAttribute("position") as BufferAttribute,
    );
    // The greybox lamp has the slot's fitted height, so the flame sits on top of either.
    expect(box.max.y - box.min.y).toBeCloseTo(SLOTS["post-lamp"].fit.size, 5);
    grey.dispose();
  });

  it("keeps every lamp out of reach of a visitor walking past", () => {
    const lampRadius = 0.1; // the slot's model is 0.19 m wide
    for (const p of pathPosts()) {
      const x = p.x - p.side * POST_LAMP_OUT;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        for (let r = 0; r <= BODY_RADIUS + lampRadius; r += 0.02) {
          expect(isClear(x + Math.cos(a) * r, p.z + Math.sin(a) * r), p.id).toBe(false);
        }
      }
    }
  });
});

describe("models", () => {
  it("makes the asset URL from the build-time origin", () => {
    expect(assetUrl("/v/abc/full/models/bell.glb", "")).toBe("/v/abc/full/models/bell.glb");
    expect(assetUrl("/v/abc/full/models/bell.glb", "https://assets.example/")).toBe(
      "https://assets.example/v/abc/full/models/bell.glb",
    );
  });

  it("orders a tier's files by priority", () => {
    const f = (slot: ManifestFile["slot"], tier: ManifestFile["tier"]): ManifestFile => ({
      src: `models/${slot}.glb`,
      slot,
      tier,
      path: `/v/x/${tier}/models/${slot}.glb`,
      sha256: "",
      bytes: 1,
      priority: SLOTS[slot].priority,
      tags: [],
      licence: "CC0",
      credit: null,
      triangles: 1,
      draws: 1,
      textures: [],
      gpuBytes: 0,
    });
    const manifest: AssetManifest = {
      release: "x",
      inputs: "y",
      files: [f("bell", "full"), f("gate", "full"), f("nandi", "full"), f("gate", "lite")],
    };
    expect(filesByPriority(manifest, "full").map((g) => g.map((x) => x.slot))).toEqual([
      ["gate"],
      ["nandi"],
      ["bell"],
    ]);
    expect(filesByPriority(manifest, "lite")).toHaveLength(1);
  });

  it("draws glTF materials with the greybox's matte lighting", () => {
    const pbr = new MeshStandardMaterial({ color: "#b08d3c", metalness: 1 });
    const matte = toMatte(pbr);
    expect(matte).toBeInstanceOf(MeshLambertMaterial);
    expect((matte as MeshLambertMaterial).color.getHexString()).toBe("b08d3c");
  });

  it("merges a model's meshes into one geometry with a group per material", () => {
    const root = new Group();
    const a = new Mesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial());
    // A quantised, indexless part without uvs, moved by its node.
    const tri = new BufferGeometry();
    tri.setAttribute(
      "position",
      new BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true),
    );
    const b = new Mesh(tri, new MeshLambertMaterial());
    b.position.set(0, 2, 0);
    root.add(a, b);
    const { geometry, materials } = mergeForInstancing(root);
    expect(materials).toHaveLength(2);
    expect(geometry.groups).toHaveLength(2);
    expect(geometry.getAttribute("uv")).toBeDefined();
    expect(geometry.boundingBox?.max.y).toBeCloseTo(3);
  });
});
