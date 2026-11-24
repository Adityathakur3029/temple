/**
 * Stone-slab paving for the walking paths: dark grey slate plates of uneven size laid across the
 * path, mottled and grained, with thin earth-filled joints between them. The texture is drawn in
 * code at boot, so nothing is downloaded (spec 11), and it repeats every SLAB_TILE metres without
 * a seam. The UVs come from world position, so pieces that overlap show the same slabs.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Matrix4,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

/** One repeat of the slab pattern, in metres: across the path and along it. */
export const SLAB_TILE = { across: 6, along: 12 } as const;

type Rng = () => number;

/** Merges path pieces into one geometry with slab UVs (no vertex colours). */
export class SlabBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];

  /**
   * Appends a geometry, transformed, with its slabs laid across a path heading `yaw` (0 runs
   * along z). Faces that point down are left out. The input geometry is disposed.
   */
  add(geometry: BufferGeometry, matrix: Matrix4 | null, yaw = 0): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    // Slabs across a path look the same whichever way it runs, so a path heading −z lays them as
    // one heading +z would. Where pieces overlap at one height they then show the same stones
    // instead of two patterns fighting (the gate path, the Ganesha forecourt, inside the gate).
    const laid = ((yaw % Math.PI) + Math.PI) % Math.PI;
    const s = Math.sin(laid);
    const c = Math.cos(laid);
    for (let i = 0; i + 2 < p.count; i += 3) {
      if (n.getY(i) < -0.5) continue;
      for (let k = i; k < i + 3; k++) {
        const x = p.getX(k);
        const y = p.getY(k);
        const z = p.getZ(k);
        const nx = n.getX(k);
        const ny = n.getY(k);
        const nz = n.getZ(k);
        this.pos.push(x, y, z);
        this.nor.push(nx, ny, nz);
        if (ny > 0.5) {
          this.uv.push((x * c - z * s) / SLAB_TILE.across, (x * s + z * c) / SLAB_TILE.along);
        } else {
          // The slab's edge: the stone runs on round the side.
          this.uv.push((z * nx - x * nz) / SLAB_TILE.across, y / SLAB_TILE.along);
        }
      }
    }
    g.dispose();
    geometry.dispose();
    return this;
  }

  /** An axis-aligned box of paving; its slabs lie across a path heading `yaw`. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, yaw = 0): this {
    return this.add(
      new BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
      new Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
      yaw,
    );
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Tileable value noise, `size`² samples in 0 … 1, starting with `freq` cells across. */
function fbm(size: number, freq: number, octaves: number, rng: Rng): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = freq << o;
    const lattice = new Float32Array(f * f);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
    const cell = size / f;
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      const r0 = (y0 % f) * f;
      const r1 = ((y0 + 1) % f) * f;
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const c0 = x0 % f;
        const c1 = (x0 + 1) % f;
        const a = lattice[r0 + c0] ?? 0;
        const b = lattice[r0 + c1] ?? 0;
        const c = lattice[r1 + c0] ?? 0;
        const d = lattice[r1 + c1] ?? 0;
        const i = y * size + x;
        out[i] = (out[i] ?? 0) + amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / total;
  return out;
}

/** A square canvas painted from tileable noise; `paint` sets one pixel's RGBA from its value. */
function noiseCanvas(
  size: number,
  freq: number,
  octaves: number,
  rng: Rng,
  paint: (v: number, px: Uint8ClampedArray, i: number) => void,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(size, size);
  const v = fbm(size, freq, octaves, rng);
  for (let i = 0; i < v.length; i++) paint(v[i] ?? 0, img.data, i * 4);
  g.putImageData(img, 0, 0);
  return canvas;
}

function setPixel(px: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): void {
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

/** One slab: its outline (metres, across × along) and how its stone looks. */
interface Plate {
  pts: [number, number][];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Brightness of the stone, and a slight lean to brown (+) or blue-grey (−). */
  tone: number;
  warm: number;
  /** Which way the grain runs (radians off across), and where the noise starts. */
  grain: number;
  ox: number;
  oy: number;
  /** How strong the pale mottling is. */
  mottle: number;
  veins: [number, number][][];
  crack: [number, number][] | null;
}

/** The slab layout for one tile: rows across the path, each cut into plates of uneven length. */
function layPlates(rng: Rng): Plate[] {
  const W = SLAB_TILE.across;
  const L = SLAB_TILE.along;
  const depths: number[] = [];
  let sum = 0;
  while (sum < L - 0.4) {
    const d = 0.6 + rng() * 0.65;
    depths.push(d);
    sum += d;
  }
  const starts = [0];
  for (const d of depths) starts.push((starts[starts.length - 1] ?? 0) + (d * L) / sum);
  // Each row's edge wavers a little across the path; the last edge is the first one, a tile on.
  const waves = depths.map(() => ({
    k1: 1 + Math.floor(rng() * 2),
    k2: 3 + Math.floor(rng() * 3),
    p1: rng() * Math.PI * 2,
    p2: rng() * Math.PI * 2,
    amp: 0.02 + rng() * 0.025,
  }));
  const edge = (row: number, a: number): number => {
    const w = waves[row % waves.length];
    const s = starts[row] ?? 0;
    if (!w) return s;
    const t = (Math.PI * 2 * a) / W;
    return s + w.amp * (0.6 * Math.sin(w.k1 * t + w.p1) + 0.4 * Math.sin(w.k2 * t + w.p2));
  };

  const plates: Plate[] = [];
  const jitter = (): number => (rng() - 0.5) * 0.008;
  depths.forEach((_, row) => {
    const lengths: number[] = [];
    let total = 0;
    while (total < W - 0.5) {
      const l = 0.85 + rng() * 1.35;
      lengths.push(l);
      total += l;
    }
    const offset = rng() * W;
    const joints = [offset];
    for (const l of lengths) joints.push((joints[joints.length - 1] ?? 0) + (l * W) / total);
    // Joints lean a little; the last joint is the first one, a tile across.
    const lean = lengths.map(() => [(rng() - 0.5) * 0.14, (rng() - 0.5) * 0.14] as const);
    const leanOf = (k: number): readonly [number, number] => lean[k % lean.length] ?? [0, 0];
    for (let k = 0; k < lengths.length; k++) {
      const left = joints[k] ?? 0;
      const right = joints[k + 1] ?? 0;
      const lo = [left + leanOf(k)[0], right + leanOf(k + 1)[0]] as const;
      const hi = [left + leanOf(k)[1], right + leanOf(k + 1)[1]] as const;
      const pts: [number, number][] = [];
      const along = (a0: number, a1: number, r: number): void => {
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.1));
        for (let i = 0; i < n; i++) {
          const a = a0 + ((a1 - a0) * i) / n;
          pts.push([a + jitter(), edge(r, a) + jitter()]);
        }
      };
      const side = (a0: number, s0: number, a1: number, s1: number): void => {
        const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / 0.1));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          pts.push([a0 + (a1 - a0) * t + jitter(), s0 + (s1 - s0) * t + jitter()]);
        }
      };
      along(lo[0], lo[1], row);
      side(lo[1], edge(row, lo[1]), hi[1], edge(row + 1, hi[1]));
      along(hi[1], hi[0], row + 1);
      side(hi[0], edge(row + 1, hi[0]), lo[0], edge(row, lo[0]));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const inside = (): [number, number] => [x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0)];
      const veins: [number, number][][] = [];
      const veinCount = rng() < 0.55 ? Math.floor(1 + rng() * 2) : 0;
      for (let v = 0; v < veinCount; v++) veins.push([inside(), inside(), inside()]);
      let crack: [number, number][] | null = null;
      if (rng() < 0.14) {
        const [cx, cy] = inside();
        crack = [];
        let a = cx;
        let s = cy;
        const dir = (rng() - 0.5) * 1.6;
        for (let i = 0; i < 6; i++) {
          crack.push([a, s]);
          a += Math.cos(dir) * 0.08 + (rng() - 0.5) * 0.04;
          s += Math.sin(dir) * 0.08 + (rng() - 0.5) * 0.04;
        }
      }
      plates.push({
        pts,
        x0,
        x1,
        y0,
        y1,
        tone: 0.84 + rng() * 0.3,
        warm: rng() * 2 - 1,
        grain: (rng() - 0.5) * 0.5,
        ox: rng() * 256,
        oy: rng() * 256,
        mottle: 0.25 + rng() * 0.35,
        veins,
        crack,
      });
    }
  });
  return plates;
}

/**
 * The slate texture for one SLAB_TILE, `width` pixels across (and twice that along). Null where
 * there is no canvas (tests).
 */
export function slabTexture(width: number, rng: Rng): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const W = SLAB_TILE.across;
  const L = SLAB_TILE.along;
  const R = width / W;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(L * R);
  const g = canvas.getContext("2d");
  if (!g) return null;

  // Light and dark swirls of the stone, pale mottled patches, a fine speckle, and the joint earth.
  const grain = noiseCanvas(256, 4, 5, rng, (v, px, i) => {
    const k = clamp01((v - 0.5) * 2.4 + 0.5) * 255;
    setPixel(px, i, k, k, k, 255);
  });
  const mottle = noiseCanvas(256, 3, 5, rng, (v, px, i) => {
    const a = smooth(clamp01((v - 0.5) / 0.16)) * 255;
    setPixel(px, i, 164, 165, 160, a);
  });
  const fine = noiseCanvas(128, 32, 2, rng, (v, px, i) => {
    const k = clamp01((v - 0.5) * 3 + 0.5) * 255;
    setPixel(px, i, k, k, k, 255);
  });
  const soil = noiseCanvas(128, 16, 3, rng, (v, px, i) => {
    const t = clamp01((v - 0.42) * 3);
    setPixel(px, i, 52 + 104 * t, 44 + 82 * t, 30 + 40 * t, 255);
  });
  if (!grain || !mottle || !fine || !soil) return null;
  const pattern = (c: HTMLCanvasElement): CanvasPattern | null => g.createPattern(c, "repeat");
  const grainP = pattern(grain);
  const mottleP = pattern(mottle);
  const fineP = pattern(fine);
  const soilP = pattern(soil);

  // The earth in the joints shows wherever no slab covers it.
  g.fillStyle = soilP ?? "#5a4b33";
  g.fillRect(0, 0, canvas.width, canvas.height);

  const plates = layPlates(rng);
  const outline = (p: Plate): Path2D => {
    const path = new Path2D();
    p.pts.forEach(([a, s], i) => (i === 0 ? path.moveTo(a * R, s * R) : path.lineTo(a * R, s * R)));
    path.closePath();
    return path;
  };
  // Each slab is drawn once for every tile it reaches into, so the edges of the tile meet.
  const copies = (p: Plate): [number, number][] => {
    const out: [number, number][] = [];
    for (const du of [-W, 0, W]) {
      for (const dv of [-L, 0, L]) {
        if (p.x1 + du < 0 || p.x0 + du > W || p.y1 + dv < 0 || p.y0 + dv > L) continue;
        out.push([du * R, dv * R]);
      }
    }
    return out;
  };

  const drawStone = (p: Plate, path: Path2D): void => {
    const bx = p.x0 * R - 2;
    const by = p.y0 * R - 2;
    const bw = (p.x1 - p.x0) * R + 4;
    const bh = (p.y1 - p.y0) * R + 4;
    const cx = ((p.x0 + p.x1) / 2) * R;
    const cy = ((p.y0 + p.y1) / 2) * R;
    g.save();
    g.clip(path);
    const base = 74 * p.tone;
    g.fillStyle = `rgb(${base + 5 * p.warm}, ${base + 1}, ${base + 4 - 5 * p.warm})`;
    g.fillRect(bx, by, bw, bh);
    // The grain runs mostly across the path; each slab's lies its own way.
    const along = (0.6 * R) / 64;
    const across = (0.15 * R) / 64;
    const turn = (m: DOMMatrix, sx: number, sy: number): DOMMatrix =>
      m.translate(cx, cy).rotate((p.grain * 180) / Math.PI).scale(sx, sy).translate(p.ox, p.oy);
    if (grainP) {
      grainP.setTransform(turn(new DOMMatrix(), along, across));
      g.globalCompositeOperation = "overlay";
      g.globalAlpha = 0.45;
      g.fillStyle = grainP;
      g.fillRect(bx, by, bw, bh);
    }
    if (mottleP) {
      mottleP.setTransform(turn(new DOMMatrix(), along * 1.4, across * 1.8));
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = p.mottle;
      g.fillStyle = mottleP;
      g.fillRect(bx, by, bw, bh);
    }
    if (fineP) {
      fineP.setTransform(turn(new DOMMatrix(), (0.05 * R) / 4, (0.03 * R) / 4));
      g.globalCompositeOperation = "overlay";
      g.globalAlpha = 0.3;
      g.fillStyle = fineP;
      g.fillRect(bx, by, bw, bh);
    }
    g.globalCompositeOperation = "source-over";
    // Feet have worn the middle of each slab a little smoother and paler.
    const wear = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bw, bh) * 0.55);
    wear.addColorStop(0, "rgba(255,255,255,0.06)");
    wear.addColorStop(1, "rgba(0,0,0,0.08)");
    g.globalAlpha = 1;
    g.fillStyle = wear;
    g.fillRect(bx, by, bw, bh);
    // Thin pale veins, and now and then a hairline crack.
    g.lineCap = "round";
    for (const v of p.veins) {
      const [a, b, c] = v;
      if (!a || !b || !c) continue;
      g.strokeStyle = "rgba(200,200,192,0.22)";
      g.lineWidth = Math.max(0.8, 0.006 * R);
      g.beginPath();
      g.moveTo(a[0] * R, a[1] * R);
      g.quadraticCurveTo(b[0] * R, b[1] * R, c[0] * R, c[1] * R);
      g.stroke();
    }
    if (p.crack) {
      g.strokeStyle = "rgba(24,21,17,0.55)";
      g.lineWidth = Math.max(0.7, 0.004 * R);
      g.beginPath();
      p.crack.forEach(([a, s], i) => (i === 0 ? g.moveTo(a * R, s * R) : g.lineTo(a * R, s * R)));
      g.stroke();
    }
    g.restore();
  };

  const paths = plates.map(outline);
  for (const [i, p] of plates.entries()) {
    const path = paths[i];
    if (!path) continue;
    for (const [du, dv] of copies(p)) {
      g.save();
      g.translate(du, dv);
      drawStone(p, path);
      g.restore();
    }
  }

  // The joints: a dark rim where dirt gathers at each slab's edge, the earth, then its shadow.
  const gap = Math.max(1.5, 0.018 * R);
  g.lineJoin = "round";
  const strokeAll = (style: string | CanvasPattern, width: number): void => {
    g.strokeStyle = style;
    g.lineWidth = width;
    for (const [i, p] of plates.entries()) {
      const path = paths[i];
      if (!path) continue;
      for (const [du, dv] of copies(p)) {
        g.save();
        g.translate(du, dv);
        g.stroke(path);
        g.restore();
      }
    }
  };
  strokeAll("rgba(16,14,11,0.32)", gap * 2.8);
  strokeAll(soilP ?? "#5a4b33", gap);
  strokeAll("rgba(22,18,12,0.45)", gap * 0.35);

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  // Paths are seen at a low angle; the renderer caps this at what the GPU allows.
  texture.anisotropy = 8;
  return texture;
}

/**
 * A near-white stone grain for the yard slabs (scene/yard-paving.ts): swirls, pale mottling and a
 * fine speckle. It multiplies the slabs' own colour, so the yard keeps its stone colour. One repeat
 * is YARD_TILE metres; `size` pixels square. Null where there is no canvas (tests).
 */
export function yardStoneTexture(size: number, rng: Rng): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const grain = noiseCanvas(256, 4, 5, rng, (v, px, i) => {
    const k = 205 + clamp01((v - 0.5) * 2.4 + 0.5) * 50;
    setPixel(px, i, k, k, k - 2, 255);
  });
  const mottle = noiseCanvas(256, 6, 4, rng, (v, px, i) => {
    const a = smooth(clamp01((v - 0.52) / 0.18)) * 70;
    setPixel(px, i, 255, 255, 250, a);
  });
  const fine = noiseCanvas(256, 64, 2, rng, (v, px, i) => {
    const k = clamp01((v - 0.5) * 3 + 0.5) * 255;
    setPixel(px, i, k, k, k, 255);
  });
  if (!grain || !mottle || !fine) return null;
  g.save();
  g.scale(size / 256, size / 256);
  g.fillStyle = g.createPattern(grain, "repeat") ?? "#e6e6e4";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = g.createPattern(mottle, "repeat") ?? "transparent";
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = "overlay";
  g.globalAlpha = 0.22;
  g.fillStyle = g.createPattern(fine, "repeat") ?? "transparent";
  g.fillRect(0, 0, 256, 256);
  g.restore();
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The path paving drawn to match the yard (scene/yard-paving.ts): large rectangular slabs of the
 * yard's grey-brown stone in staggered rows across the path, a shade lighter or darker each, with
 * the yard's grain on top and narrow earth joints. One repeat is SLAB_TILE; `width` pixels across.
 * Null where there is no canvas (tests).
 */
export function yardPathTexture(width: number, rng: Rng, base = "#8b8375", joint = "#6e5a40"): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const W = SLAB_TILE.across;
  const L = SLAB_TILE.along;
  const R = width / W;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(L * R);
  const g = canvas.getContext("2d");
  if (!g) return null;

  // The same near-white grain as the yard's stone texture, laid over each slab's colour.
  const grain = noiseCanvas(256, 4, 5, rng, (v, px, i) => {
    const k = 205 + clamp01((v - 0.5) * 2.4 + 0.5) * 50;
    setPixel(px, i, k, k, k - 2, 255);
  });
  const mottle = noiseCanvas(256, 6, 4, rng, (v, px, i) => {
    const a = smooth(clamp01((v - 0.52) / 0.18)) * 70;
    setPixel(px, i, 255, 255, 250, a);
  });
  const fine = noiseCanvas(256, 64, 2, rng, (v, px, i) => {
    const k = clamp01((v - 0.5) * 3 + 0.5) * 255;
    setPixel(px, i, k, k, k, 255);
  });

  g.fillStyle = joint;
  g.fillRect(0, 0, canvas.width, canvas.height);

  // Rows along the path, 0.95 … 1.5 m deep, scaled to fill the tile exactly.
  const depths: number[] = [];
  let sum = 0;
  while (sum < L - 0.6) {
    const d = 0.95 + rng() * 0.55;
    depths.push(d);
    sum += d;
  }
  const hex = Number.parseInt(base.slice(1), 16);
  const br = (hex >> 16) & 255;
  const bg = (hex >> 8) & 255;
  const bb = hex & 255;
  const J = 0.035; // joint width in metres, as in the yard
  let y = 0;
  for (const d0 of depths) {
    const d = (d0 * L) / sum;
    // Slabs 1.2 … 2.2 m long across the path, scaled to fill the tile, from a random start.
    const lengths: number[] = [];
    let total = 0;
    while (total < W - 0.8) {
      const l = 1.2 + rng() * 1.0;
      lengths.push(l);
      total += l;
    }
    let x = rng() * W;
    for (const l0 of lengths) {
      const l = (l0 * W) / total;
      const tone = 0.9 + rng() * 0.2;
      const warm = (rng() - 0.5) * 0.04;
      const fill = `rgb(${Math.min(255, br * (tone + warm))}, ${Math.min(255, bg * tone)}, ${Math.min(255, bb * (tone - warm))})`;
      const rx = (x + J / 2) * R;
      const ry = (y + J / 2) * R;
      const rw = (l - J) * R;
      const rh = (d - J) * R;
      // Drawn again one tile across where it runs off the edge, so the tile meets itself.
      for (const du of [0, -W * R]) {
        if (rx + du > canvas.width) continue;
        g.fillStyle = fill;
        g.fillRect(rx + du, ry, rw, rh);
        // A thin darker rim: the slab's side catching less light, as in the yard.
        g.strokeStyle = "rgba(0,0,0,0.18)";
        g.lineWidth = Math.max(1, 0.012 * R);
        g.strokeRect(rx + du + g.lineWidth / 2, ry + g.lineWidth / 2, rw - g.lineWidth, rh - g.lineWidth);
      }
      x += l;
    }
    y += d;
  }

  // The grain multiplies every slab (the earth joints too, which barely changes them).
  if (grain && mottle && fine) {
    // One grain repeat is 3 m (close to the yard's 4 m) so it divides the tile with no seam.
    const scale = (3 * R) / 256;
    g.save();
    g.scale(scale, scale);
    const w = canvas.width / scale;
    const h = canvas.height / scale;
    const layer = document.createElement("canvas");
    layer.width = 256;
    layer.height = 256;
    const lg = layer.getContext("2d");
    if (lg) {
      lg.fillStyle = lg.createPattern(grain, "repeat") ?? "#e6e6e4";
      lg.fillRect(0, 0, 256, 256);
      lg.fillStyle = lg.createPattern(mottle, "repeat") ?? "transparent";
      lg.fillRect(0, 0, 256, 256);
      lg.globalCompositeOperation = "overlay";
      lg.globalAlpha = 0.22;
      lg.fillStyle = lg.createPattern(fine, "repeat") ?? "transparent";
      lg.fillRect(0, 0, 256, 256);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = g.createPattern(layer, "repeat") ?? "transparent";
      g.fillRect(0, 0, w, h);
    }
    g.restore();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** One repeat of the grass pattern, in metres. */
export const GRASS_TILE = 3;

/**
 * The lawn inside the compound wall: patchy green turf, darker and lighter tufts, a few dry
 * yellow patches, and many short blades so it reads as grass, not paint. Tileable, drawn at boot.
 */
export function grassTexture(size: number, rng: Rng): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;

  // Turf: broad light and dark patches of green.
  const turf = noiseCanvas(256, 4, 5, rng, (v, px, i) => {
    const t = clamp01((v - 0.5) * 2.6 + 0.5);
    setPixel(px, i, 60 + 40 * t, 92 + 46 * t, 34 + 18 * t, 255);
  });
  // Dry patches, where the turf turns straw-coloured.
  const dry = noiseCanvas(256, 3, 4, rng, (v, px, i) => {
    const a = smooth(clamp01((v - 0.6) / 0.14)) * 150;
    setPixel(px, i, 150, 142, 74, a);
  });
  if (!turf || !dry) return null;
  for (const c of [turf, dry]) {
    const p = g.createPattern(c, "repeat");
    if (!p) continue;
    g.save();
    g.scale(size / 256, size / 256);
    g.fillStyle = p;
    g.fillRect(0, 0, 256, 256);
    g.restore();
  }

  // Blades: short tapered strokes leaning a little each way, drawn wrapped so the tile meets.
  const blades = Math.round(size * size * 0.035);
  const len = size / 90;
  g.lineCap = "round";
  for (let n = 0; n < blades; n++) {
    const x = rng() * size;
    const y = rng() * size;
    const lean = (rng() - 0.5) * 1.1;
    const l = len * (0.6 + rng() * 0.9);
    const dx = Math.sin(lean) * l;
    const dy = -Math.cos(lean) * l;
    const k = rng();
    // Mostly darker shadowed blades with lighter sunlit tips here and there.
    g.strokeStyle =
      k < 0.55
        ? `rgba(${34 + k * 30}, ${62 + k * 40}, 22, 0.75)`
        : `rgba(${110 + k * 50}, ${150 + k * 40}, ${58 + k * 20}, 0.7)`;
    g.lineWidth = Math.max(1, size / 512) * (0.8 + rng() * 0.6);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < -len * 2 || sx > size + len * 2 || sy < -len * 2 || sy > size + len * 2) continue;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + dx, sy + dy);
        g.stroke();
      }
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  texture.anisotropy = 8;
  return texture;
}
