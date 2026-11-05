import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
} from "three";
import { describe, expect, it } from "vitest";
import type { AssetManifest, ManifestFile } from "../src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../src/assets/slots";
import { MeshBuilder, withoutSection } from "../src/scene/builder";
import { buildGreybox } from "../src/scene/greybox";
import { assetUrl, filesByPriority, mergeForInstancing, toMatte } from "../src/scene/models";

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
    const grey = buildGreybox({ mode: "half-somasutra", trees: 10, footwearPairs: 1 });
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
