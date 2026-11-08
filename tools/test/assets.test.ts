import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document } from "@gltf-transform/core";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { AssetManifest, ManifestFile } from "../../apps/web/src/assets/manifest";
import { SLOT_IDS, SLOTS } from "../../apps/web/src/assets/slots";
import { parseConfig, tagsFor, type SlotConfig } from "../assets/config";
import { fitMatrix, rotationXYZ, transformPoint } from "../assets/fit";
import { releaseHash, sha256 } from "../assets/inputs";
import { buildSlot, gpuBytes, makeIO, textureSize } from "../assets/pipeline";
import { checkManifest, checkModelImports, checkTotals } from "../check/assets";

const licences = "# Asset licences\n\n## models/bell.glb\n- Source: test\n\n## models/nandi.glb\n";
const env = { exists: () => true, licences };
const good = {
  file: "models/bell/bell.glb",
  licence: "CC-BY-4.0",
  credit: '"Bell" by Someone, CC BY 4.0',
  interim: true,
};

function cfg(over: Partial<SlotConfig> = {}): SlotConfig {
  return {
    file: "models/bell/bell.glb",
    licence: "CC0",
    credit: null,
    interim: true,
    ai: false,
    fit: "auto",
    rotate: [0, 0, 0],
    scale: 1,
    offset: [0, 0, 0],
    ...over,
  };
}

describe("the slot table", () => {
  it("places every single slot and no instanced one", () => {
    for (const id of SLOT_IDS) {
      const s = SLOTS[id];
      expect(s.kind === "single", id).toBe(s.place !== undefined);
      expect(s.maxTriangles, id).toBeGreaterThan(0);
      expect(s.fit.size, id).toBeGreaterThan(0);
    }
  });

  it("marks exactly the linga, Nandi and Ganesha as sacred (spec 08)", () => {
    expect(SLOT_IDS.filter((id) => SLOTS[id].sacred)).toEqual(["linga", "nandi", "ganesha"]);
  });
});

describe("parseConfig", () => {
  it("accepts a complete entry and fills in defaults", () => {
    const { config, problems } = parseConfig({ slots: { bell: good } }, env);
    expect(problems).toEqual([]);
    expect(config.slots.bell).toMatchObject({
      fit: "auto",
      rotate: [0, 0, 0],
      scale: 1,
      ai: false,
    });
  });

  it("rejects unknown slots, settings and licences", () => {
    const { problems } = parseConfig(
      {
        slots: {
          tower: good,
          bell: { ...good, licence: "CC-BY-NC-4.0", colour: "red" },
        },
      },
      env,
    );
    expect(problems.join("\n")).toMatch(/slots\.tower: unknown slot/);
    expect(problems.join("\n")).toMatch(/slots\.bell\.colour: unknown setting/);
    expect(problems.join("\n")).toMatch(/slots\.bell\.licence/);
  });

  it("needs a credit for CC-BY and a LICENSES.md entry", () => {
    const { problems } = parseConfig(
      { slots: { bell: { ...good, credit: undefined }, mat: { ...good, licence: "CC0" } } },
      env,
    );
    expect(problems.some((p) => p.startsWith("slots.bell.credit"))).toBe(true);
    expect(problems.some((p) => p.includes('"## models/mat.glb"'))).toBe(true);
  });

  it("allows a downloaded model in a sacred slot but never an AI-made one", () => {
    const nandi = { ...good, file: "models/nandi/nandi.glb", ai: false };
    expect(parseConfig({ slots: { nandi } }, env).problems).toEqual([]);
    const ai = parseConfig({ slots: { nandi: { ...nandi, ai: true } } }, env).problems;
    expect(ai.some((p) => p.startsWith("slots.nandi.ai"))).toBe(true);
  });

  it("needs an explicit ai: false, and keeps a downloaded sacred form interim", () => {
    const nandi = { ...good, file: "models/nandi/nandi.glb" };
    const silent = parseConfig({ slots: { nandi } }, env).problems;
    expect(silent.some((p) => p.includes('explicit "ai": false'))).toBe(true);
    const final = parseConfig({ slots: { nandi: { ...nandi, ai: false, interim: false } } }, env);
    expect(final.problems.some((p) => p.startsWith("slots.nandi.interim"))).toBe(true);
    const own = { ...nandi, ai: false, interim: false, licence: "own", credit: undefined };
    expect(parseConfig({ slots: { nandi: own } }, env).problems).toEqual([]);
  });

  it("keeps files inside assets-src and needs an explicit interim flag", () => {
    const { problems } = parseConfig(
      { slots: { bell: { ...good, file: "../secret.glb", interim: undefined } } },
      env,
    );
    expect(problems.some((p) => p.startsWith("slots.bell.file"))).toBe(true);
    expect(problems.some((p) => p.startsWith("slots.bell.interim"))).toBe(true);
  });

  it("tags sacred and interim models", () => {
    expect(tagsFor("nandi", cfg())).toEqual(["nandi", "sacred", "interim"]);
    expect(tagsFor("bell", cfg({ interim: false }))).toEqual(["bell"]);
  });
});

describe("fitting", () => {
  it("turns +z towards +x with a quarter turn about y", () => {
    const p = transformPoint(rotationXYZ([0, 90, 0]), [0, 0, 1]);
    expect(p[0]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(0);
  });

  it("scales to the slot size and moves the top centre to the origin (bells hang)", () => {
    const { matrix, scale } = fitMatrix({ min: [-10, 0, 5], max: [10, 64, 25] }, SLOTS.bell, cfg());
    expect(scale).toBeCloseTo(0.32 / 64);
    const top = transformPoint(matrix, [0, 64, 15]);
    top.forEach((v) => expect(v).toBeCloseTo(0));
    expect(transformPoint(matrix, [0, 0, 15])[1]).toBeCloseTo(-0.32);
  });

  it("applies the config scale and offset after fitting; fit none keeps the model as made", () => {
    const { matrix } = fitMatrix(
      { min: [-1, 0, -1], max: [1, 2, 1] },
      SLOTS["deepa-stand"],
      cfg({ scale: 2, offset: [0, 0.1, 0] }),
    );
    expect(transformPoint(matrix, [0, 2, 0])[1]).toBeCloseTo(2.35 * 2 + 0.1);
    const none = fitMatrix(
      { min: [-1, 0, -1], max: [1, 2, 1] },
      SLOTS["deepa-stand"],
      cfg({ fit: "none" }),
    );
    expect(transformPoint(none.matrix, [1, 2, 1])).toEqual([1, 2, 1]);
  });

  it("picks power-of-two texture sizes within the tier limit", () => {
    expect(textureSize(1000, 300, 1024)).toEqual([1024, 256]);
    expect(textureSize(4096, 4096, 512)).toEqual([512, 512]);
    // Rounded down unless within 10% of the next size: no blurry upscaling.
    expect(textureSize(1500, 700, 2048)).toEqual([1024, 512]);
  });

  it("estimates GPU memory with mipmaps at 8 bits per pixel", () => {
    expect(gpuBytes([[1024, 1024]])).toBe(Math.round(1024 * 1024 * (4 / 3)));
  });
});

/** A two-part "bell" made in centimetres, lying along z, with a 600×300 texture. */
async function sampleModel(dir: string, segments = 24): Promise<string> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // A closed cylinder-ish shape, 64 cm tall along z (so it needs turning upright).
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= segments; j++) {
      const a = (i / segments) * Math.PI * 2;
      const z = (j / segments) * 64;
      const r = 10 + 6 * Math.sin((j / segments) * Math.PI);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
      uv.push(i / segments, j / segments);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const png = await sharp({
    // Noise, so prune doesn't fold a one-colour texture into the material colour.
    create: {
      width: 600,
      height: 300,
      channels: 3,
      background: { r: 176, g: 141, b: 60 },
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
  const tex = doc.createTexture("brass").setImage(new Uint8Array(png)).setMimeType("image/png");
  const brass = doc.createMaterial("brass").setBaseColorTexture(tex).setMetallicFactor(1);
  const half = idx.length / 2 - ((idx.length / 2) % 3);
  const prim = (indices: number[], material: typeof brass) =>
    doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer),
      )
      .setAttribute(
        "TEXCOORD_0",
        doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer),
      )
      .setIndices(doc.createAccessor().setArray(new Uint32Array(indices)).setBuffer(buffer))
      .setMaterial(material);
  const mesh = doc
    .createMesh("bell")
    .addPrimitive(prim(idx.slice(0, half), brass))
    .addPrimitive(prim(idx.slice(half), brass));
  const node = doc.createNode("bell").setMesh(mesh).setTranslation([5, 3, 0]);
  doc.createScene().addChild(node);
  const file = join(dir, "bell.glb");
  writeFileSync(file, await (await makeIO()).writeBinary(doc));
  return file;
}

function ktx2Size(data: Uint8Array): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [view.getUint32(20, true), view.getUint32(24, true)];
}

describe("buildSlot", () => {
  const dir = mkdtempSync(join(tmpdir(), "sannidhi-assets-"));

  it("turns, fits, joins and packs a model with KTX2 textures per tier", async () => {
    const file = await sampleModel(dir);
    const built = await buildSlot("bell", cfg({ rotate: [-90, 0, 0] }), file);
    expect(built.draws).toBe(1); // two primitives, one material: joined
    expect(built.tiers.full.triangles).toBeLessThanOrEqual(SLOTS.bell.maxTriangles);
    const height = built.bounds.max[1] - built.bounds.min[1];
    expect(height).toBeCloseTo(0.32, 3);
    expect(built.bounds.max[1]).toBeCloseTo(0, 3); // the top is the origin
    expect((built.bounds.min[0] + built.bounds.max[0]) / 2).toBeCloseTo(0, 3);

    const io = await makeIO();
    for (const [tier, size] of [
      ["full", [512, 256]],
      ["lite", [256, 256]],
    ] as const) {
      const doc = await io.readBinary(built.tiers[tier].bytes);
      const used = doc
        .getRoot()
        .listExtensionsUsed()
        .map((e) => e.extensionName);
      expect(used).toEqual(
        expect.arrayContaining(["KHR_texture_basisu", "EXT_meshopt_compression"]),
      );
      const textures = doc.getRoot().listTextures();
      expect(textures).toHaveLength(1);
      expect(textures[0]?.getMimeType()).toBe("image/ktx2");
      expect(ktx2Size(textures[0]?.getImage() ?? new Uint8Array(32))).toEqual(size);
    }
  }, 60_000);

  it("simplifies a model over its triangle budget", async () => {
    const file = await sampleModel(mkdtempSync(join(tmpdir(), "sannidhi-dense-")), 60);
    const built = await buildSlot("bell", cfg({ rotate: [-90, 0, 0] }), file);
    expect(built.tiers.full.triangles).toBeLessThanOrEqual(SLOTS.bell.maxTriangles);
    expect(built.notes.some((n) => n.startsWith("simplified from 7,200"))).toBe(true);
    // Lite aims for half the triangles.
    expect(built.tiers.lite.triangles).toBeLessThanOrEqual(SLOTS.bell.maxTriangles / 2);
  }, 60_000);
});

describe("checkManifest", () => {
  const data = new Uint8Array([1, 2, 3]);
  const file = (over: Partial<ManifestFile> = {}): ManifestFile => ({
    src: "models/bell.glb",
    slot: "bell",
    tier: "full",
    path: "",
    sha256: sha256(data),
    bytes: 3,
    priority: "P2",
    tags: ["bell", "interim"],
    licence: "CC0",
    credit: null,
    triangles: 500,
    draws: 1,
    textures: [],
    gpuBytes: 0,
    ...over,
  });
  const manifestOf = (files: ManifestFile[]): AssetManifest => {
    const release = releaseHash(files);
    return {
      release,
      inputs: "x",
      files: files.map((f) => ({ ...f, path: `/v/${release}/${f.tier}/${f.src}` })),
    };
  };
  const config = { slots: { bell: cfg({ licence: "CC0" }) } };

  it("passes a consistent manifest", () => {
    const m = manifestOf([file(), file({ tier: "lite" })]);
    expect(checkManifest(m, config, () => data)).toEqual([]);
  });

  it("flags missing files, changed files, budgets and a missing tier", () => {
    const m = manifestOf([file({ triangles: 900, bytes: 4 })]);
    const problems = checkManifest(m, config, () => null).join("\n");
    expect(problems).toMatch(/is missing/);
    expect(problems).toMatch(/900 triangles > 800/);
    expect(problems).toMatch(/no lite file/);
    const changed = checkManifest(
      manifestOf([file(), file({ tier: "lite" })]),
      config,
      () => new Uint8Array([9]),
    );
    expect(changed.join("\n")).toMatch(/doesn't match/);
  });

  it("adds up every copy's triangles and the GPU textures per tier", () => {
    // 156 far trees at 120 triangles is 18,720; at 1,500 it would be 234,000.
    expect(SLOTS.tree.copies?.full).toBe(156);
    const tree = (triangles: number, gpu = 0): ManifestFile =>
      file({ slot: "tree", src: "models/tree.glb", priority: "P0", triangles, gpuBytes: gpu });
    expect(checkTotals({ release: "r", inputs: "i", files: [tree(120)] })).toEqual([]);
    expect(checkTotals({ release: "r", inputs: "i", files: [tree(1500)] }).join()).toMatch(
      /full models: 234,000 triangles/,
    );
    expect(
      checkTotals({ release: "r", inputs: "i", files: [tree(100, 150_000_000)] }).join(),
    ).toMatch(/GPU textures/);
  });

  it("requires the sacred tag on sacred slots", () => {
    const nandi = file({ slot: "nandi", src: "models/nandi.glb", priority: "P1", tags: [] });
    const m = manifestOf([nandi, { ...nandi, tier: "lite" }]);
    const problems = checkManifest(m, { slots: { nandi: cfg() } }, () => data);
    expect(problems.join("\n")).toMatch(/"sacred" tag/);
  });
});

describe("checkModelImports", () => {
  it("lets only scene code load models", () => {
    const src = mkdtempSync(join(tmpdir(), "sannidhi-src-"));
    mkdirSync(join(src, "scene"));
    mkdirSync(join(src, "ui"));
    writeFileSync(join(src, "scene", "temple.ts"), 'import { SceneModels } from "./models";');
    writeFileSync(join(src, "ui", "ok.ts"), 'import { t } from "../i18n/t";');
    writeFileSync(join(src, "ui", "donate.ts"), 'import m from "../assets/manifest.json";');
    writeFileSync(join(src, "ui", "lazy.ts"), 'const m = import("../scene/models");');
    writeFileSync(join(src, "ui", "icon.tsx"), 'const src = "/v/1adff65d/full/models/nandi.glb";');
    writeFileSync(join(src, "ui", "hud.css"), ".x { background: url(/v/1a/lite/a.png); }");
    expect(checkModelImports(src).sort()).toEqual([
      "ui/donate.ts: only scene code may load models (spec 08, spec 11)",
      "ui/hud.css: only scene code may load models (spec 08, spec 11)",
      "ui/icon.tsx: only scene code may load models (spec 08, spec 11)",
      "ui/lazy.ts: only scene code may load models (spec 08, spec 11)",
    ]);
  });
});
