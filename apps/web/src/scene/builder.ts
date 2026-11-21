/**
 * Merges many simple shapes into one vertex-coloured, non-indexed geometry, so the whole static
 * greybox costs one draw call (render budgets, spec 10).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Vector3,
  type ColorRepresentation,
} from "three";

/** A run of vertices in a built geometry. */
export interface Run {
  start: number;
  count: number;
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new Color();
  private readonly runs = new Map<string, Run[]>();
  private open: { name: string; start: number } | null = null;

  get triangles(): number {
    return this.pos.length / 9;
  }

  get vertices(): number {
    return this.pos.length / 3;
  }

  /**
   * Names the shapes added from now on (null ends the section), so they can be cut out of the
   * built geometry later with `withoutSection`. A name may be used for several runs.
   */
  section(name: string | null): this {
    if (this.open && this.vertices > this.open.start) {
      const list = this.runs.get(this.open.name) ?? [];
      list.push({ start: this.open.start, count: this.vertices - this.open.start });
      this.runs.set(this.open.name, list);
    }
    this.open = name === null ? null : { name, start: this.vertices };
    return this;
  }

  /** The named runs, closing any open section. */
  sections(): Map<string, Run[]> {
    this.section(null);
    return new Map([...this.runs].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  }

  /** An axis-aligned box. Its bottom face is skipped when it rests on the ground (y0 ≤ 0). */
  box(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: ColorRepresentation,
    skip: { bottom?: boolean } = { bottom: y0 <= 0 },
  ): this {
    this.c.set(color);
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]): void => {
      for (const p of [a, b, c, a, c, d]) {
        this.pos.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
        this.nor.push(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
        this.col.push(this.c.r, this.c.g, this.c.b);
      }
    };
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
    if (!skip.bottom) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    return this;
  }

  /**
   * Appends a three.js geometry, transformed. `flat` recomputes per-face normals (a faceted stone
   * look); otherwise the geometry's own normals are kept. The input geometry is disposed.
   */
  add(
    geometry: BufferGeometry,
    matrix: Matrix4 | null,
    color: ColorRepresentation,
    flat = false,
  ): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (flat) {
      g.deleteAttribute("normal");
      g.computeVertexNormals();
    }
    this.c.set(color);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    g.dispose();
    geometry.dispose();
    return this;
  }

  /** Appends a geometry, colouring each vertex by a function of its world position. */
  addShaded(
    geometry: BufferGeometry,
    matrix: Matrix4 | null,
    shade: (x: number, y: number, z: number, out: Color) => void,
  ): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    g.deleteAttribute("normal");
    g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      shade(p.getX(i), p.getY(i), p.getZ(i), this.c);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    g.dispose();
    geometry.dispose();
    return this;
  }

  build(): BufferGeometry {
    this.section(null);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * A copy of a non-indexed geometry without one section's vertices. The other sections' runs in
 * `runs` are moved to match, and the removed section is deleted from it.
 */
export function withoutSection(
  geometry: BufferGeometry,
  runs: Map<string, Run[]>,
  name: string,
): BufferGeometry {
  const drop = [...(runs.get(name) ?? [])].sort((a, b) => a.start - b.start);
  runs.delete(name);
  const total = geometry.getAttribute("position").count;
  // Vertices removed before a given index, for moving the remaining runs.
  const removedBefore = (index: number): number =>
    drop.reduce((n, r) => n + (r.start < index ? Math.min(r.count, index - r.start) : 0), 0);
  const keep: Run[] = [];
  let at = 0;
  for (const r of drop) {
    if (r.start > at) keep.push({ start: at, count: r.start - at });
    at = Math.max(at, r.start + r.count);
  }
  if (at < total) keep.push({ start: at, count: total - at });

  const out = new BufferGeometry();
  for (const key of ["position", "normal", "color"] as const) {
    const src = geometry.getAttribute(key);
    if (!src) continue;
    const size = src.itemSize;
    const data = new Float32Array(keep.reduce((n, r) => n + r.count, 0) * size);
    let o = 0;
    for (const r of keep) {
      data.set((src.array as Float32Array).subarray(r.start * size, (r.start + r.count) * size), o);
      o += r.count * size;
    }
    out.setAttribute(key, new BufferAttribute(data, size));
  }
  for (const list of runs.values()) {
    for (const r of list) r.start -= removedBefore(r.start);
  }
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Translation · rotation about +y · scale. */
export function placed(
  x: number,
  y: number,
  z: number,
  yaw = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): Matrix4 {
  const m = new Matrix4().makeRotationY(yaw);
  m.scale(new Vector3(sx, sy, sz));
  m.setPosition(x, y, z);
  return m;
}
