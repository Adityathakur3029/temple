/**
 * The open yard and the courtyard: large rectangular stone slabs laid in staggered rows, each a
 * real block standing a little above the earth, with narrow earth-filled joints between them.
 * The slabs keep the yard's own stone colour (vertex colours); a neutral stone texture drawn at
 * boot adds grain and mottling on top, so nothing is downloaded (spec 11).
 */
import { BufferAttribute, BufferGeometry, Color } from "three";

type Rng = () => number;

export interface YardRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Joint width between slabs, in metres. */
const JOINT = 0.035;
/** One repeat of the stone texture on the slabs, in metres. */
export const YARD_TILE = 4;

/** Removes `cut` from `r`, leaving up to two rectangles. */
function subtract(r: YardRect, cut: YardRect): YardRect[] {
  if (r.x1 <= cut.x0 || r.x0 >= cut.x1 || r.z1 <= cut.z0 || r.z0 >= cut.z1) return [r];
  const out: YardRect[] = [];
  if (r.z0 < cut.z0) out.push({ ...r, z1: cut.z0 });
  if (r.z1 > cut.z1) out.push({ ...r, z0: cut.z1 });
  const z0 = Math.max(r.z0, cut.z0);
  const z1 = Math.min(r.z1, cut.z1);
  if (r.x0 < cut.x0) out.push({ x0: r.x0, x1: cut.x0, z0, z1 });
  if (r.x1 > cut.x1) out.push({ x0: cut.x1, x1: r.x1, z0, z1 });
  return out;
}

/** Builds the slab blocks: top faces with world UVs, darker sides where the stone stands up. */
export class YardSlabBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];

  private quad(
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    n: readonly number[],
    colour: Color,
    uvs: readonly number[],
  ): void {
    for (const [i, v] of [a, b, c, a, c, d].entries()) {
      this.pos.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
      this.nor.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
      this.col.push(colour.r, colour.g, colour.b);
      const k = [0, 1, 2, 0, 2, 3][i] ?? 0;
      this.uv.push(uvs[k * 2] ?? 0, uvs[k * 2 + 1] ?? 0);
    }
  }

  /** One slab block from the earth (y 0) to `top`. */
  slab(r: YardRect, top: number, colour: Color): void {
    const { x0, x1, z0, z1 } = r;
    const T = YARD_TILE;
    this.quad(
      [x0, top, z1],
      [x1, top, z1],
      [x1, top, z0],
      [x0, top, z0],
      [0, 1, 0],
      colour,
      [x0 / T, z1 / T, x1 / T, z1 / T, x1 / T, z0 / T, x0 / T, z0 / T],
    );
    // The sides catch less light and some earth; they show the slab's thickness.
    const side = colour.clone().multiplyScalar(0.6);
    const h = top / T;
    const sides: [number[], number[], number[]][] = [
      [[x0, z1], [x1, z1], [0, 0, 1]],
      [[x1, z1], [x1, z0], [1, 0, 0]],
      [[x1, z0], [x0, z0], [0, 0, -1]],
      [[x0, z0], [x0, z1], [-1, 0, 0]],
    ];
    for (const [p, q, n] of sides) {
      const [px = 0, pz = 0] = p;
      const [qx = 0, qz = 0] = q;
      const u0 = (px + pz) / T;
      const u1 = (qx + qz) / T;
      this.quad([px, 0, pz], [qx, 0, qz], [qx, top, qz], [px, top, pz], n, side, [
        u0, 0, u1, 0, u1, h, u0, h,
      ]);
    }
  }

  /**
   * Fills `area` with staggered rows of slabs (rows run along x), skipping `cuts`. Each slab's
   * stone is `base` a shade lighter or darker, and its top `top` give or take a few millimetres.
   */
  pave(area: YardRect, base: string, top: number, rng: Rng, cuts: readonly YardRect[] = []): this {
    const c = new Color(base);
    let z = area.z0;
    while (z < area.z1 - 0.05) {
      const depth = Math.min(0.95 + rng() * 0.55, area.z1 - z);
      let x = area.x0 - rng() * 1.2;
      while (x < area.x1) {
        const len = 1.2 + rng() * 1.0;
        let pieces: YardRect[] = [
          {
            x0: Math.max(area.x0, x + JOINT / 2),
            x1: Math.min(area.x1, x + len - JOINT / 2),
            z0: z + JOINT / 2,
            z1: z + depth - JOINT / 2,
          },
        ];
        for (const cut of cuts) pieces = pieces.flatMap((p) => subtract(p, cut));
        const tone = 0.9 + rng() * 0.2;
        const warm = (rng() - 0.5) * 0.04;
        const colour = new Color(
          Math.min(1, c.r * (tone + warm)),
          Math.min(1, c.g * tone),
          Math.min(1, c.b * (tone - warm)),
        );
        const t = top + (rng() - 0.5) * 0.006;
        for (const p of pieces) if (p.x1 - p.x0 > 0.05 && p.z1 - p.z0 > 0.05) this.slab(p, t, colour);
        x += len;
      }
      z += depth;
    }
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
