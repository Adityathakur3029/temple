import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  bootFiles,
  formatResults,
  gzipBytes,
  measureWeb,
  overBudget,
  uncountedFiles,
} from "../check/size";

describe("bootFiles", () => {
  it("follows static imports from the entry but not dynamic ones", () => {
    expect(
      bootFiles({
        "index.html": {
          file: "assets/index.js",
          isEntry: true,
          imports: ["_shared.js"],
          css: ["assets/a.css"],
        },
        "_shared.js": { file: "assets/shared.js", imports: ["index.html"] },
        "src/scene.ts": { file: "assets/scene.js" },
      }),
    ).toEqual(["assets/index.js", "assets/a.css", "assets/shared.js"]);
  });
});

describe("measureWeb", () => {
  const dist = mkdtempSync(join(tmpdir(), "sannidhi-size-"));
  mkdirSync(join(dist, ".vite"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>x</title>");
  writeFileSync(join(dist, "assets", "index.js"), "console.log(1);");
  writeFileSync(join(dist, "assets", "scene.js"), "x".repeat(400_000));
  writeFileSync(
    join(dist, ".vite", "manifest.json"),
    JSON.stringify({
      "index.html": { file: "assets/index.js", isEntry: true, dynamicImports: ["src/scene.ts"] },
      "src/scene.ts": { file: "assets/scene.js", isDynamicEntry: true },
    }),
  );

  it("measures gzip sizes per budget line and leaves asset lines unmeasured", () => {
    const results = Object.fromEntries(measureWeb(dist).map((r) => [r.id, r]));
    const boot = gzipBytes(Buffer.from("console.log(1);"));
    expect(results.bootJs?.bytes).toBe(boot);
    expect(results.allJs?.bytes).toBe(boot + gzipBytes(Buffer.from("x".repeat(400_000))));
    expect(results.fonts?.bytes).toBe(0);
    expect(results.firstView?.bytes).toBeNull();
    expect(results.fullScene?.bytes).toBeNull();
  });

  it("flags lines over their limit", () => {
    const results = measureWeb(dist).map((r) =>
      r.id === "allJs" ? { ...r, bytes: BUDGETS.allJs.limit + 1 } : r,
    );
    expect(overBudget(results).map((r) => r.id)).toEqual(["allJs"]);
  });
});

describe("measureWeb with CSS, wasm and other files", () => {
  const dist = mkdtempSync(join(tmpdir(), "sannidhi-size2-"));
  mkdirSync(join(dist, ".vite"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html>");
  writeFileSync(join(dist, "_headers"), "/assets/*");
  writeFileSync(join(dist, "assets", "index.js"), "1");
  writeFileSync(join(dist, "assets", "index.css"), "body{margin:0}");
  writeFileSync(join(dist, "assets", "basis.wasm"), "wasm");
  writeFileSync(join(dist, "assets", "logo.png"), "png");
  writeFileSync(
    join(dist, ".vite", "manifest.json"),
    JSON.stringify({
      "index.html": { file: "assets/index.js", isEntry: true, css: ["assets/index.css"] },
    }),
  );
  const byId = Object.fromEntries(measureWeb(dist).map((r) => [r.id, r]));
  const gz = (s: string): number => gzipBytes(Buffer.from(s));

  it("counts CSS linked by the entry with the HTML", () => {
    expect(byId.html?.bytes).toBe(gz("<!doctype html>") + gz("body{margin:0}"));
  });

  it("counts wasm before interactive, and marks that line partial", () => {
    expect(byId.beforeInteractive?.bytes).toBe(
      gz("<!doctype html>") + gz("body{margin:0}") + gz("1") + gz("wasm"),
    );
    expect(byId.beforeInteractive?.partial).toBe(true);
    expect(formatResults(measureWeb(dist))).toContain("ok (partial)");
  });

  it("lists the aarti line as not measured", () => {
    expect(byId.aarti?.bytes).toBeNull();
    expect(byId.aarti?.limit).toBe(6_000_000);
  });

  it("lists built files that no budget line counts", () => {
    expect(uncountedFiles(dist)).toEqual(["assets/logo.png"]);
  });
});

describe("measureWeb with an asset manifest", () => {
  const dist = mkdtempSync(join(tmpdir(), "sannidhi-size3-"));
  mkdirSync(join(dist, ".vite"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html>");
  writeFileSync(join(dist, "assets", "index.js"), "1");
  writeFileSync(
    join(dist, ".vite", "manifest.json"),
    JSON.stringify({ "index.html": { file: "assets/index.js", isEntry: true } }),
  );
  const file = (slot: "gate" | "bell", tier: "full" | "lite", bytes: number) => ({
    src: `models/${slot}.glb`,
    slot,
    tier,
    path: `/v/r/${tier}/models/${slot}.glb`,
    sha256: "",
    bytes,
    priority: slot === "gate" ? ("P0" as const) : ("P2" as const),
    tags: [],
    licence: "CC0" as const,
    credit: null,
    triangles: 1,
    draws: 1,
    textures: [],
    gpuBytes: 0,
  });

  it("counts models per tier, and Full-tier P0 models as first view", () => {
    const results = Object.fromEntries(
      measureWeb(dist, {
        release: "r",
        inputs: "i",
        files: [
          file("gate", "full", 300_000),
          file("gate", "lite", 100_000),
          file("bell", "full", 50_000),
          file("bell", "lite", 20_000),
        ],
      }).map((r) => [r.id, r]),
    );
    expect(results.firstView?.bytes).toBe(300_000);
    const app = results.beforeInteractive!.bytes! - 300_000;
    expect(results.fullScene?.bytes).toBe(app + 350_000);
    expect(results.liteScene?.bytes).toBe(app + 120_000);
    expect(results.beforeInteractive?.partial).toBeUndefined();
  });

  it("measures zero, not 'not measured', when no model is configured", () => {
    const results = Object.fromEntries(
      measureWeb(dist, { release: null, inputs: "i", files: [] }).map((r) => [r.id, r]),
    );
    expect(results.fullScene?.bytes).toBe(results.beforeInteractive?.bytes);
    expect(results.fullScene?.note).toBe("the app; no models yet");
  });

  it("counts files under v/ through the manifest, not as uncounted", () => {
    mkdirSync(join(dist, "v", "r", "full", "models"), { recursive: true });
    writeFileSync(join(dist, "v", "r", "full", "models", "gate.glb"), "glb");
    expect(uncountedFiles(dist)).toEqual([]);
  });
});
