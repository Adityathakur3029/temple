/**
 * Download budgets from specs/10-performance.md § Download budgets. These are hard limits.
 * Reads the Vite build manifest (apps/web/dist/.vite/manifest.json); asset lines need the
 * asset manifest (spec 11) and report "not measured" until it exists.
 * Sizes are compressed over the wire, measured as gzip level 9. 1 kB = 1000 bytes, which is
 * stricter than 1024. WOFF2 and other pre-compressed formats count at their file size.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const KB = 1000;
const MB = 1000 * KB;

/** Keep in step with the spec 10 table. */
export const BUDGETS = {
  html: { label: "HTML + inline critical CSS", limit: 15 * KB },
  bootJs: { label: "Boot JS (main.ts chunk)", limit: 30 * KB },
  allJs: { label: "All JS (boot + scene + UI)", limit: 350 * KB },
  fonts: { label: "Fonts for first view (one language)", limit: 120 * KB },
  firstView: { label: "First-view assets", limit: 2.5 * MB },
  beforeInteractive: { label: "Total before the temple is interactive", limit: 3 * MB },
  fullScene: { label: "Full scene, Full tier", limit: 12 * MB },
  liteScene: { label: "Full scene, Lite tier", limit: 5 * MB },
  aarti: { label: "Aarti recording (each)", limit: 6 * MB },
} as const;

export type BudgetId = keyof typeof BUDGETS;

export interface BudgetResult {
  id: BudgetId;
  label: string;
  limit: number;
  /** Bytes, or null when it can't be measured yet. */
  bytes: number | null;
  /** Measured, but some of what the line covers can't be counted yet. */
  partial?: boolean;
  note?: string;
}

interface ViteChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
}
type ViteManifest = Record<string, ViteChunk>;

export function gzipBytes(buf: Buffer): number {
  return gzipSync(buf, { level: 9 }).byteLength;
}

/** index.html's chunk plus everything it imports statically (dynamic imports load later). */
export function bootFiles(manifest: ViteManifest): string[] {
  if (!manifest["index.html"]) throw new Error("Vite manifest has no index.html entry");
  const files = new Set<string>();
  const visit = (key: string): void => {
    const chunk = manifest[key];
    if (!chunk || files.has(chunk.file)) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  visit("index.html");
  return [...files];
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => join(dir, f));
}

export function measureWeb(dist: string): BudgetResult[] {
  const manifestPath = join(dist, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${manifestPath} not found. Build the web app first (npm run build -w @sannidhi/web).`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ViteManifest;
  const sizeOf = (file: string): number => gzipBytes(readFileSync(join(dist, file)));
  const files = walk(dist).map((f) => relative(dist, f).replace(/\\/g, "/"));

  const sum = (list: string[]): number => list.reduce((total, f) => total + sizeOf(f), 0);
  const boot = bootFiles(manifest);

  // CSS linked by the entry blocks rendering, so it counts with the HTML.
  const html = sizeOf("index.html") + sum(boot.filter((f) => f.endsWith(".css")));
  const bootJs = sum(boot.filter((f) => f.endsWith(".js")));
  const allJs = sum(files.filter((f) => f.endsWith(".js")));
  const otherCss = sum(files.filter((f) => f.endsWith(".css") && !boot.includes(f)));
  // Decoders (Basis, meshopt) ship as .wasm; they are needed before the first textured view.
  const wasm = sum(files.filter((f) => f.endsWith(".wasm")));
  // WOFF2 is already compressed. Until per-language subsets exist, count every font (upper bound).
  const fontFiles = files.filter((f) => /\.woff2?$/.test(f));
  const fonts = fontFiles.reduce((sum, f) => sum + readFileSync(join(dist, f)).byteLength, 0);

  const noAssets = "needs the asset manifest (spec 11)";
  const result = (
    id: BudgetId,
    bytes: number | null,
    note?: string,
    partial = false,
  ): BudgetResult => ({
    id,
    ...BUDGETS[id],
    bytes,
    ...(partial ? { partial } : {}),
    ...(note === undefined ? {} : { note }),
  });

  return [
    result("html", html),
    result("bootJs", bootJs),
    result("allJs", allJs),
    result(
      "fonts",
      fonts,
      fontFiles.length === 0 ? "no fonts shipped yet" : "all fonts, upper bound",
    ),
    result("firstView", null, noAssets),
    result(
      "beforeInteractive",
      html + allJs + otherCss + wasm + fonts,
      "HTML, CSS, JS, wasm, fonts; P0 assets and the asset manifest not counted yet",
      true,
    ),
    result("fullScene", null, noAssets),
    result("liteScene", null, noAssets),
    result("aarti", null, noAssets),
  ];
}

/** Built files that no budget line counts yet, so nothing ships unmeasured without notice. */
export function uncountedFiles(dist: string): string[] {
  const counted = /^(index\.html|_headers|\.vite\/.*|.*\.(js|css|wasm|woff2?))$/;
  return walk(dist)
    .filter((f) => statSync(f).isFile())
    .map((f) => relative(dist, f).replace(/\\/g, "/"))
    .filter((f) => !counted.test(f));
}

export function overBudget(results: BudgetResult[]): BudgetResult[] {
  return results.filter((r) => r.bytes !== null && r.bytes > r.limit);
}

export function formatBytes(n: number): string {
  return n >= MB ? `${(n / MB).toFixed(2)} MB` : `${(n / KB).toFixed(1)} kB`;
}

export function formatResults(results: BudgetResult[]): string {
  const rows = results.map((r) => {
    const status =
      r.bytes === null
        ? "not measured"
        : r.bytes > r.limit
          ? "OVER"
          : r.partial
            ? "ok (partial)"
            : "ok";
    const measured = r.bytes === null ? "—" : formatBytes(r.bytes);
    return [r.label, measured, `≤ ${formatBytes(r.limit)}`, status, r.note ?? ""];
  });
  const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((row) => row[i]?.length ?? 0)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i < 4 ? cell.padEnd(widths[i] ?? 0) : cell))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
