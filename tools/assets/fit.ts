/**
 * Turning and fitting a model to its slot (spec 11 § Slots). Matrices are column-major 4×4
 * arrays, as glTF and glTF-Transform use them.
 */
import type { SlotSpec } from "../../apps/web/src/assets/slots";
import type { SlotConfig, Vec3 } from "./config";

export type Mat4 = number[];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a · b */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function scaling(s: number): Mat4 {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

/** Turns about x, then y, then z (degrees): Rz · Ry · Rx. */
export function rotationXYZ([dx, dy, dz]: Vec3): Mat4 {
  const r = Math.PI / 180;
  const [cx, sx] = [Math.cos(dx * r), Math.sin(dx * r)];
  const [cy, sy] = [Math.cos(dy * r), Math.sin(dy * r)];
  const [cz, sz] = [Math.cos(dz * r), Math.sin(dz * r)];
  const rx: Mat4 = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1];
  const ry: Mat4 = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1];
  const rz: Mat4 = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // Snap float noise so a 90° turn stays exact.
  return multiply(rz, multiply(ry, rx)).map((v) => (Math.abs(v) < 1e-12 ? 0 : v));
}

export function transformPoint(m: Mat4, [x, y, z]: Vec3): Vec3 {
  const at = (i: number): number => m[i] ?? 0;
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ];
}

const AXIS = { x: 0, y: 1, z: 2 } as const;

/**
 * The matrix that takes an already turned model (with these bounds) into its slot: scaled evenly
 * so the slot's fit axis measures the slot's size, its bottom or top centre moved to the origin,
 * then the config's own scale and offset. With `fit: "none"` only scale and offset apply.
 */
export function fitMatrix(
  bounds: Bounds,
  spec: SlotSpec,
  cfg: SlotConfig,
): { matrix: Mat4; scale: number } {
  const [ox, oy, oz] = cfg.offset;
  if (cfg.fit === "none") {
    return { matrix: multiply(translation(ox, oy, oz), scaling(cfg.scale)), scale: cfg.scale };
  }
  const i = AXIS[spec.fit.axis];
  const measured = bounds.max[i] - bounds.min[i];
  if (!(measured > 1e-9)) {
    throw new Error(`the model has no size along ${spec.fit.axis}, so it can't be fitted`);
  }
  const s = (spec.fit.size / measured) * cfg.scale;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const py = spec.origin === "bottom" ? bounds.min[1] : bounds.max[1];
  return {
    matrix: multiply(translation(ox, oy, oz), multiply(scaling(s), translation(-cx, -py, -cz))),
    scale: s,
  };
}
