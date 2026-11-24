/**
 * Painted panels on the outer walls of the garbhagriha (spec 02 § Shrine), seen while walking
 * pradakshina: folk patterns in the pahadi manner, in lime white, geru red, turmeric yellow, leaf
 * green and indigo, a little faded.
 *
 * Patterns only (owner, 2026-11-24): lotus, vine, bel leaves, marigold, kalash and diya. No
 * figures, no deity, and none of the sacred symbols of spec 08 (ॐ, trishul, damru). Nothing on
 * the front (east) wall, so the darshan view through the door stays as it is.
 *
 * Drawn once in code onto one 1024 × 1024 canvas (no download), merged into one mesh: one draw
 * (spec 10). Placed on the shrine model's wall faces (make_shrine.py): the central projection
 * (bhadra) of each side at 2.48 m from the centre carries a large square panel, and each recessed
 * face (2.35 m) a narrow one.
 *
 * The compound wall carries long friezes in the same manner on its raised panels, on every other
 * bay between two pillars, on both faces (owner, 2026-11-24): a second 2048 × 512 canvas with two
 * friezes, one more draw.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";

/** Wall faces of the shrine model between its base mouldings and the band at 3.3 m. */
const BHADRA_FACE = 2.48;
const RECESS_FACE = 2.35;
const RECESS_U = 1.5; // centre of each recessed face along the wall
const STAND_OFF = 0.006; // just proud of the stone, so it never flickers

const BIG = { w: 1.5, h: 1.5, y0: 1.28 };
const SMALL = { w: 0.66, h: 1.32, y0: 1.37 };

/** Atlas cells, in UV (0..1, v up): two large designs on top, three narrow ones below. */
const CELL = {
  lotus: [0, 0.5, 0.5, 1],
  kalash: [0.5, 0.5, 1, 1],
  vine: [0, 0, 0.25, 0.5],
  diya: [0.25, 0, 0.5, 0.5],
  marigold: [0.5, 0, 0.75, 0.5],
} as const;
type Cell = keyof typeof CELL;

export const PAINT = {
  plaster: "#e9dcc0",
  plasterShade: "#d9c7a3",
  geru: "#a63a22",
  geruDark: "#7c2817",
  turmeric: "#e0a526",
  marigold: "#e8781e",
  leaf: "#4f7a3a",
  leafDark: "#355a2a",
  indigo: "#2f4a7a",
  pink: "#d9727a",
  white: "#f6f0e2",
  brass: "#b8923e",
};

/**
 * A raised panel of the compound wall that carries a frieze: the run's direction, its line, the
 * panel's ends along the run, and which frieze (they alternate round the wall).
 */
export interface FriezeSpot {
  alongX: boolean;
  line: number;
  u0: number;
  u1: number;
  variant: 0 | 1;
}

/** The compound wall's raised panels: their faces, 0.2 m either side of the wall line. */
const PANEL_FACE = 0.2;
const PANEL_Y0 = 0.5;
const PANEL_Y1 = 1.02;

/** The frieze canvas: two long friezes, one above the other. */
const FRIEZE_CELLS: readonly [number, number, number, number][] = [
  [0, 0.5, 1, 1],
  [0, 0, 1, 0.5],
];

/**
 * The sanctum's panels and the compound wall's friezes: two meshes, one draw each (spec 10).
 * Empty without a DOM (the unit tests).
 */
export function buildWallPaintings(friezes: readonly FriezeSpot[], lite = false): Mesh[] {
  if (typeof document === "undefined") return [];
  const meshes: Mesh[] = [];
  // Lite mode and Low phones paint at half size (a quarter of the memory), spec 10.
  const k = lite ? 0.5 : 1;

  const atlas = canvasOf(1024, 1024, paintAtlas, k);
  if (atlas) {
    const q = new Quads();
    // Outward normals of the north (+x), west (−z, the back) and south (−x) walls.
    const sides: { n: Vector3; big: Cell; small: [Cell, Cell] }[] = [
      { n: new Vector3(1, 0, 0), big: "kalash", small: ["vine", "diya"] },
      { n: new Vector3(0, 0, -1), big: "lotus", small: ["marigold", "marigold"] },
      { n: new Vector3(-1, 0, 0), big: "kalash", small: ["diya", "vine"] },
    ];
    for (const { n, big, small } of sides) {
      const right = rightOf(n);
      const at = (face: number, along: number): Vector3 =>
        n
          .clone()
          .multiplyScalar(face + STAND_OFF)
          .addScaledVector(right, along);
      q.add(at(BHADRA_FACE, 0), n, BIG.w, BIG.y0, BIG.y0 + BIG.h, CELL[big]);
      q.add(at(RECESS_FACE, -RECESS_U), n, SMALL.w, SMALL.y0, SMALL.y0 + SMALL.h, CELL[small[0]]);
      q.add(at(RECESS_FACE, RECESS_U), n, SMALL.w, SMALL.y0, SMALL.y0 + SMALL.h, CELL[small[1]]);
    }
    meshes.push(q.mesh(atlas, "sanctum-paintings", lite));
  }

  const frieze = friezes.length > 0 ? canvasOf(2048, 512, paintFriezes, k) : null;
  if (frieze) {
    const q = new Quads();
    for (const f of friezes) {
      const mid = (f.u0 + f.u1) / 2;
      const w = f.u1 - f.u0;
      // Both faces of the wall: the lawn side and the outside.
      for (const s of [-1, 1]) {
        const n = f.alongX ? new Vector3(0, 0, s) : new Vector3(s, 0, 0);
        const c = f.alongX
          ? new Vector3(mid, 0, f.line + s * (PANEL_FACE + STAND_OFF))
          : new Vector3(f.line + s * (PANEL_FACE + STAND_OFF), 0, mid);
        q.add(c, n, w, PANEL_Y0, PANEL_Y1, FRIEZE_CELLS[f.variant] ?? [0, 0, 1, 1]);
      }
    }
    meshes.push(q.mesh(frieze, "wall-friezes", lite));
  }
  return meshes;
}

/** A visitor facing a wall with outward normal n looks along −n; their right is (−n) × up. */
function rightOf(n: Vector3): Vector3 {
  return n
    .clone()
    .negate()
    .cross(new Vector3(0, 1, 0));
}

/** Upright painted quads, gathered into one mesh. */
class Quads {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];
  private readonly nor: number[] = [];

  /** A quad centred on `c` (its y ignored), `w` wide, from y0 to y1, facing n. */
  add(c: Vector3, n: Vector3, w: number, y0: number, y1: number, cell: readonly number[]): void {
    const right = rightOf(n);
    const [u0 = 0, v0 = 0, u1 = 1, v1 = 1] = cell;
    const corner = (s: number, top: boolean): void => {
      const p = c.clone().addScaledVector(right, (s * w) / 2);
      this.pos.push(p.x, top ? y1 : y0, p.z);
      this.uv.push(s < 0 ? u0 : u1, top ? v1 : v0);
      this.nor.push(n.x, n.y, n.z);
    };
    corner(-1, false);
    corner(1, false);
    corner(1, true);
    corner(-1, false);
    corner(1, true);
    corner(-1, true);
  }

  mesh(canvas: HTMLCanvasElement, name: string, lite: boolean): Mesh {
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = lite ? 1 : 4;
    // On Lite, free the canvas's own memory once the GPU has its copy (phones back 2D canvases on
    // the GPU too). If the GL context is ever lost and restored, the panels then show plain.
    if (lite) {
      map.onUpdate = () => {
        canvas.width = 1;
        canvas.height = 1;
        map.onUpdate = null;
      };
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    const mesh = new Mesh(geo, new MeshLambertMaterial({ map }));
    mesh.name = name;
    return mesh;
  }
}

/** A w × h design painted at `k` times its size (the painters always draw at full size). */
export function canvasOf(
  w: number,
  h: number,
  paint: (ctx: Ctx) => void,
  k = 1,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(k, k);
  paint(ctx);
  return canvas;
}

// --- The compound wall's friezes (each 2048 × 256, for a panel about 4 m × 0.52 m) ------------------

function paintFriezes(ctx: Ctx): void {
  const rnd = seeded(27);
  const W = 2048;
  const H = 256;
  for (let v = 0; v < 2; v++) {
    ctx.save();
    ctx.translate(0, v * H);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ground(ctx, W, H, rnd);
    if (v === 0) friezeGarlands(ctx, W, H);
    else friezeVine(ctx, W, H);
    age(ctx, W, H, rnd);
    ctx.restore();
  }
}

/** A lotus medallion in the middle, marigold swags either side, a small kalash at each end. */
function friezeGarlands(ctx: Ctx, W: number, H: number): void {
  const cy = H / 2;
  petals(ctx, W / 2, cy, 8, H * 0.3, H * 0.11, PAINT.geru, PAINT.white, 0);
  petals(ctx, W / 2, cy, 8, H * 0.2, H * 0.08, PAINT.pink, PAINT.white, Math.PI / 8);
  ctx.fillStyle = PAINT.turmeric;
  dot(ctx, W / 2, cy, H * 0.07);
  const swags = 4;
  for (const side of [-1, 1]) {
    for (let k = 0; k < swags; k++) {
      const a = W / 2 + side * (H * 0.45 + k * W * 0.085);
      const b = a + side * W * 0.085;
      for (let i = 0; i <= 9; i++) {
        const t = i / 9;
        flower(ctx, a + (b - a) * t, H * 0.3 + Math.sin(t * Math.PI) * H * 0.3, H * 0.055);
      }
      belLeaf(ctx, b, H * 0.34, H * 0.1);
    }
    miniKalash(ctx, W / 2 + side * W * 0.44, H * 0.62, H * 0.17);
  }
}

/** A running vine with marigolds and bel leaves, and three diyas in the middle. */
function friezeVine(ctx: Ctx, W: number, H: number): void {
  const cy = H / 2;
  const y = (x: number): number => cy + Math.sin((x / W) * Math.PI * 14) * H * 0.16;
  ctx.strokeStyle = PAINT.leafDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = W * 0.06; x <= W * 0.94; x += 6) {
    if (Math.abs(x - W / 2) < W * 0.09) {
      ctx.moveTo(x + 6, y(x + 6));
      continue;
    }
    ctx.lineTo(x, y(x));
  }
  ctx.stroke();
  let k = 0;
  for (let x = W * 0.08; x <= W * 0.92; x += W * 0.036, k++) {
    if (Math.abs(x - W / 2) < W * 0.09) continue;
    const off = k % 2 ? 1 : -1;
    if (k % 3 === 0) flower(ctx, x, y(x) + off * H * 0.17, H * 0.06);
    else leaf(ctx, x, y(x), H * 0.16, H * 0.06, (off * Math.PI) / 2 + 0.5, PAINT.leaf);
  }
  for (let i = -1; i <= 1; i++) miniDiya(ctx, W / 2 + i * H * 0.5, cy + H * 0.08, H * 0.3);
}

function miniKalash(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = PAINT.brass;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - r * 0.4, y - r * 1.3, r * 0.8, r * 0.5);
  for (let i = -2; i <= 2; i++)
    leaf(ctx, x + i * r * 0.2, y - r * 1.3, r * 0.6, r * 0.18, -Math.PI / 2 + i * 0.45, PAINT.leaf);
  ctx.fillStyle = "#8a5a2b";
  ctx.beginPath();
  ctx.ellipse(x, y - r * 1.5, r * 0.3, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAINT.geru;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.1, r * 0.98, r * 0.24, 0, 0.05, Math.PI - 0.05);
  ctx.stroke();
}

function miniDiya(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.fillStyle = PAINT.geru;
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.4, s * 0.16, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillRect(x - s * 0.4, y - s * 0.05, s * 0.8, s * 0.06);
  ctx.fillStyle = PAINT.marigold;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.42);
  ctx.quadraticCurveTo(x + s * 0.14, y - s * 0.12, x, y - s * 0.04);
  ctx.quadraticCurveTo(x - s * 0.14, y - s * 0.12, x, y - s * 0.42);
  ctx.fill();
  ctx.fillStyle = PAINT.turmeric;
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.13, s * 0.05, s * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// Painting (canvas y runs down; atlas cell v = 1 is the canvas top)
// ---------------------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function paintAtlas(ctx: Ctx): void {
  const rnd = seeded(108);
  const cellRect = (cell: Cell): [number, number, number, number] => {
    const [u0, v0, u1, v1] = CELL[cell];
    return [u0 * 1024, (1 - v1) * 1024, (u1 - u0) * 1024, (v1 - v0) * 1024];
  };
  for (const cell of Object.keys(CELL) as Cell[]) {
    const [x, y, w, h] = cellRect(cell);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    ground(ctx, w, h, rnd);
    if (cell === "lotus") lotusPanel(ctx, w, h);
    else if (cell === "kalash") kalashPanel(ctx, w, h);
    else if (cell === "vine") vinePanel(ctx, w, h);
    else if (cell === "diya") diyaPanel(ctx, w, h);
    else marigoldPanel(ctx, w, h);
    age(ctx, w, h, rnd);
    ctx.restore();
  }
}

/** Lime plaster with a geru frame, a thin turmeric line and white dots, as on village walls. */
function ground(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  ctx.fillStyle = PAINT.plaster;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? PAINT.plasterShade : PAINT.white;
    ctx.globalAlpha = 0.25;
    const r = 4 + rnd() * 18;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const b = Math.round(Math.min(w, h) * 0.07);
  ctx.fillStyle = PAINT.geru;
  ctx.fillRect(0, 0, w, b);
  ctx.fillRect(0, h - b, w, b);
  ctx.fillRect(0, 0, b, h);
  ctx.fillRect(w - b, 0, b, h);
  ctx.fillStyle = PAINT.white;
  const step = b * 0.9;
  for (let t = step / 2; t < w; t += step) {
    dot(ctx, t, b / 2, b * 0.13);
    dot(ctx, t, h - b / 2, b * 0.13);
  }
  for (let t = step / 2; t < h; t += step) {
    dot(ctx, b / 2, t, b * 0.13);
    dot(ctx, w - b / 2, t, b * 0.13);
  }
  ctx.strokeStyle = PAINT.turmeric;
  ctx.lineWidth = b * 0.18;
  ctx.strokeRect(b * 1.25, b * 1.25, w - b * 2.5, h - b * 2.5);
}

/** The back wall: a large eight-petalled lotus in rings, with a leaf vine round it. */
function lotusPanel(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  // Vine ring.
  ctx.strokeStyle = PAINT.leafDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    leaf(
      ctx,
      cx + Math.cos(a) * w * 0.36,
      cy + Math.sin(a) * w * 0.36,
      26,
      11,
      a + (i % 2 ? 0.6 : -0.6) + Math.PI / 2,
      PAINT.leaf,
    );
  }
  petals(ctx, cx, cy, 16, w * 0.29, w * 0.07, PAINT.pink, PAINT.geruDark, Math.PI / 16);
  petals(ctx, cx, cy, 8, w * 0.25, w * 0.1, PAINT.geru, PAINT.white, 0);
  petals(ctx, cx, cy, 8, w * 0.16, w * 0.07, PAINT.pink, PAINT.white, Math.PI / 8);
  ctx.fillStyle = PAINT.turmeric;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.065, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.geruDark;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    dot(ctx, cx + Math.cos(a) * w * 0.042, cy + Math.sin(a) * w * 0.042, 3.5);
  }
  // Corner flowers.
  for (const [fx, fy] of [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.2, 0.8],
    [0.8, 0.8],
  ] as const) {
    petals(ctx, fx * w, fy * h, 4, w * 0.045, w * 0.022, PAINT.indigo, PAINT.white, Math.PI / 4);
    ctx.fillStyle = PAINT.turmeric;
    dot(ctx, fx * w, fy * h, w * 0.012);
  }
}

/** The side walls: a brass kalash with mango leaves and a coconut, on a lotus seat, with bel leaves. */
function kalashPanel(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  const base = h * 0.76;
  // Lotus seat.
  ctx.fillStyle = PAINT.pink;
  for (let i = -3; i <= 3; i++) {
    ctx.save();
    ctx.translate(cx + i * w * 0.045, base);
    ctx.rotate(i * 0.22);
    petalShape(ctx, w * 0.12, w * 0.035);
    ctx.fill();
    ctx.strokeStyle = PAINT.geruDark;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  // Pot.
  const r = w * 0.15;
  const potY = base - r * 0.95;
  ctx.fillStyle = PAINT.brass;
  ctx.beginPath();
  ctx.ellipse(cx, potY, r, r * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - r * 0.42, potY - r * 1.25, r * 0.84, r * 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, potY - r * 1.25, r * 0.6, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PAINT.geru;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(cx, potY - r * 0.1, r * 0.98, r * 0.25, 0, 0.05, Math.PI - 0.05);
  ctx.stroke();
  ctx.fillStyle = PAINT.white;
  for (let i = -3; i <= 3; i++) dot(ctx, cx + i * r * 0.24, potY + r * 0.35, 5);
  // Mango leaves and the coconut.
  const mouth = potY - r * 1.3;
  for (let i = -2; i <= 2; i++) {
    leaf(
      ctx,
      cx + i * r * 0.22,
      mouth - r * 0.15,
      r * 0.55,
      r * 0.17,
      -Math.PI / 2 + i * 0.45,
      PAINT.leaf,
    );
  }
  ctx.fillStyle = "#8a5a2b";
  ctx.beginPath();
  ctx.ellipse(cx, mouth - r * 0.35, r * 0.32, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.geru;
  ctx.fillRect(cx - r * 0.33, mouth - r * 0.3, r * 0.66, r * 0.12);
  // Bel (three-leaf) sprigs and dots either side.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      belLeaf(ctx, cx + s * w * 0.3, h * (0.28 + k * 0.2), w * 0.05);
    }
  }
  ctx.fillStyle = PAINT.indigo;
  for (let i = 0; i < 9; i++) dot(ctx, w * (0.2 + i * 0.075), h * 0.86, 5);
}

/** A climbing vine with bel leaves and small marigolds. */
function vinePanel(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  ctx.strokeStyle = PAINT.leafDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let y = h * 0.12; y <= h * 0.88; y += 4) {
    const x = cx + Math.sin((y / h) * Math.PI * 5) * w * 0.18;
    if (y === h * 0.12) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let k = 0; k < 10; k++) {
    const y = h * (0.15 + k * 0.075);
    const x = cx + Math.sin((y / h) * Math.PI * 5) * w * 0.18;
    const side = k % 2 ? 1 : -1;
    if (k % 3 === 1) flower(ctx, x + side * w * 0.17, y, w * 0.06);
    else belLeaf(ctx, x + side * w * 0.15, y, w * 0.07);
  }
}

/** A column of three lit diyas on small lotus stands. */
function diyaPanel(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  for (let k = 0; k < 3; k++) {
    const y = h * (0.28 + k * 0.24);
    // Stand.
    petals(
      ctx,
      cx,
      y + w * 0.13,
      6,
      w * 0.13,
      w * 0.05,
      PAINT.pink,
      PAINT.geruDark,
      -Math.PI / 2,
      Math.PI,
    );
    // Lamp bowl.
    ctx.fillStyle = PAINT.geru;
    ctx.beginPath();
    ctx.ellipse(cx, y + w * 0.06, w * 0.2, w * 0.08, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillRect(cx - w * 0.2, y + w * 0.035, w * 0.4, w * 0.03);
    // Flame.
    ctx.fillStyle = PAINT.marigold;
    ctx.beginPath();
    ctx.moveTo(cx, y - w * 0.16);
    ctx.quadraticCurveTo(cx + w * 0.07, y - w * 0.02, cx, y + w * 0.03);
    ctx.quadraticCurveTo(cx - w * 0.07, y - w * 0.02, cx, y - w * 0.16);
    ctx.fill();
    ctx.fillStyle = PAINT.turmeric;
    ctx.beginPath();
    ctx.ellipse(cx, y - w * 0.02, w * 0.025, w * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A hanging marigold garland in loops, with leaves. */
function marigoldPanel(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  for (let k = 0; k < 4; k++) {
    const y0 = h * (0.16 + k * 0.18);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = w * 0.22 + t * w * 0.56;
      const y = y0 + Math.sin(t * Math.PI) * h * 0.09;
      flower(ctx, x, y, w * 0.05);
    }
    leaf(ctx, cx, y0 + h * 0.13, w * 0.12, w * 0.04, Math.PI / 2, PAINT.leaf);
  }
}

// --- Small brushes -------------------------------------------------------------------------------

export function dot(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function petalShape(ctx: Ctx, len: number, wid: number): void {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, -len * 0.5, 0, -len);
  ctx.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
}

export function petals(
  ctx: Ctx,
  cx: number,
  cy: number,
  n: number,
  len: number,
  wid: number,
  fill: string,
  line: string,
  turn: number,
  spread = Math.PI * 2,
): void {
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn + (spread === Math.PI * 2 ? (i / n) * spread : (i / (n - 1) - 0.5) * spread));
    petalShape(ctx, len, wid);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
}

export function leaf(
  ctx: Ctx,
  x: number,
  y: number,
  len: number,
  wid: number,
  angle: number,
  fill: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2);
  petalShape(ctx, len, wid);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PAINT.leafDark;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.9);
  ctx.stroke();
  ctx.restore();
}

/** A bel sprig: three leaves from one point. */
export function belLeaf(ctx: Ctx, x: number, y: number, s: number): void {
  for (const a of [-Math.PI / 2, -Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1]) {
    leaf(ctx, x, y, a === -Math.PI / 2 ? s * 1.25 : s, s * 0.42, a, PAINT.leaf);
  }
}

/** A marigold: a ring of orange dots round a yellow heart. */
export function flower(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = PAINT.marigold;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    dot(ctx, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.42);
  }
  ctx.fillStyle = PAINT.turmeric;
  dot(ctx, x, y, r * 0.45);
}

/** Fading and small flakes, so the paint looks old and loved rather than new. */
export function age(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  ctx.fillStyle = PAINT.plaster;
  ctx.globalAlpha = 0.14;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rnd() < 0.7 ? PAINT.plaster : PAINT.plasterShade;
    dot(ctx, rnd() * w, rnd() * h, 1 + rnd() * 3.5);
  }
  ctx.globalAlpha = 1;
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
