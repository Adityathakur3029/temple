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

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new Color();

  get triangles(): number {
    return this.pos.length / 9;
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
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
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
