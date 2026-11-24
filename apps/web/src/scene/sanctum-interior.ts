/**
 * The inside of the garbhagriha (spec 02 § Shrine), the heart of the temple: what a visitor sees
 * through the sanctum door from the mandapa, behind and around the linga.
 *
 * - **Walls** (north, west and south; the east wall with the door is behind the viewer): a
 *   moulded stone base with a carved lotus-petal band, a body of dressed stone blocks with carved
 *   pilasters, lotus rosettes and lattice panels, a painted folk frieze in geru and lime white, a
 *   projecting band, an upper course darkened by generations of lamp smoke, and a stepped cornice.
 * - **Behind the linga**, a tall carved frame with a running vine scroll around a niche under a
 *   cusped arch, painted geru red with lime-white bel sprigs, so the dark linga stands out against it.
 *   A swag of marigolds and jasmine hangs across the arch.
 * - **Floor**: a polished dark slab under the pitha, edged with a brass inlay line, a ring of
 *   dressed slabs, and a border of pale inlaid diamonds. A stone channel carries abhisheka water
 *   from the pitha's spout to the north wall, where the outer spout (the somasutra) begins.
 * - **Ceiling**: a carved lotus in a square coffer.
 * - **The light**: one brass hanging lamp with five flames, on a chain from the ceiling in front of
 *   the linga. The sanctum's point light sits at its flames (`SANCTUM_LAMP`) and flickers gently
 *   with them; with reduced motion it burns still (spec 07 § Accessibility).
 * - **Two purna kalash** (copper pot, mango leaves, coconut) on stone rings in the back corners.
 *
 * Patterns only: no figures, no deity, and no sacred symbols on the floor (spec 08). Nothing
 * touches the linga or its pitha; the linga slot stays as it is.
 *
 * Drawn in code: one 1024 × 1024 canvas (512 × 512 in Lite mode and on Low phones), no download.
 * The light is baked into vertex colours (unlit materials), so the sun never lights the inside
 * through the roof on tiers without shadow maps, and the whole sanctum flickers with its lamp for
 * free. Three draws: the stone, the props, the flames (spec 10).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { PLINTH } from "./ground";
import { PAINT, age, belLeaf, canvasOf, dot, flower, seeded } from "./wall-paintings";

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

// --- Measurements (metres, world space; the linga is at the origin, the door faces +z) ----------

/** Top of the sanctum floor, where the linga slot stands. */
const FLOOR = PLINTH + 0.015;
/** Inner wall faces of the shrine model (and the greybox lining's, 1 cm in front). */
const INNER = 2.2;
/** Painted and carved faces stand this far in front of the walls, so they never flicker. */
const SKIN = 0.02;
/** Just under the model's ceiling (4.3 m) and the greybox lining's (4.29 m). */
const CEIL = 4.285;
const BODY = { y0: 0.86, y1: 2.36 };
const FRIEZE = { y0: 2.36, y1: 2.61 };
const UPPER = { y0: 2.69, y1: 4.0 };

/** The flames of the hanging lamp: the sanctum's point light stands here. */
export const SANCTUM_LAMP = { x: 0, y: 2.53, z: 1.05 } as const;

/** Mouldings round the three walls: height band, how far each stands out from the wall. */
const MOULDINGS: readonly { y0: number; y1: number; d: number; tone: keyof typeof ALBEDO }[] = [
  { y0: FLOOR, y1: 0.6, d: 0.12, tone: "stoneDark" }, // plinth course
  { y0: 0.6, y1: 0.8, d: 0.09, tone: "stone" }, // lotus-petal band (its face is textured)
  { y0: 0.8, y1: 0.86, d: 0.11, tone: "stoneLight" }, // fillet
  { y0: 2.61, y1: 2.69, d: 0.07, tone: "stoneLight" }, // band over the frieze
  { y0: 4.0, y1: 4.1, d: 0.08, tone: "stone" }, // cornice, three steps
  { y0: 4.1, y1: 4.2, d: 0.14, tone: "stoneLight" },
  { y0: 4.2, y1: CEIL, d: 0.2, tone: "stoneDark" },
];
const PETAL_BAND = MOULDINGS[1] ?? { y0: 0.6, y1: 0.8, d: 0.09 };
const PLINTH_COURSE = MOULDINGS[0] ?? { d: 0.12 };

// --- Colours ----------------------------------------------------------------------------------

/** Canvas colours (sRGB). */
const STONE = {
  base: "#71695c",
  light: "#8b8170",
  dark: "#544c42",
  deep: "#3b352e",
  joint: "#2a251f",
  floorDark: "#2f2b27",
  floor: "#5d564b",
  floorLight: "#6f675a",
  inlay: "#b9aa8b",
  brass: "#a8843a",
  niche: "#82301f",
  nicheDark: "#5c2015",
};

/** Vertex albedo for the props and the untextured moulding faces (converted to linear). */
const ALBEDO = {
  white: new Color("#ffffff"),
  stone: new Color(STONE.base),
  stoneLight: new Color(STONE.light),
  stoneDark: new Color(STONE.dark),
  wet: new Color("#1d1a17"),
  hole: new Color("#0b0908"),
  brass: new Color("#c09a45"),
  copper: new Color("#b8673a"),
  leaf: new Color("#3d6a2c"),
  coconut: new Color("#6b4728"),
  husk: new Color("#8f6c40"),
  thread: new Color("#b3261c"),
  marigold: new Color("#ec7a1c"),
  yellow: new Color("#f3b62c"),
  jasmine: new Color("#f1ece0"),
};

// --- The light, baked into vertex colours ------------------------------------------------------

const LAMP = new Vector3(SANCTUM_LAMP.x, SANCTUM_LAMP.y + 0.03, SANCTUM_LAMP.z);
const LAMP_RGB = [1.0, 0.6, 0.3] as const;
const AMBIENT_RGB = [0.2, 0.18, 0.16] as const;
const LAMP_GAIN = 3.0;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => v * v * (3 - 2 * v);

/** How much of the lamp reaches p: the pitha and the linga cast a soft shadow on the floor. */
function lampReach(p: Vector3): number {
  let worst = 0;
  for (let i = 1; i < 18; i++) {
    const t = i / 18;
    const x = p.x + (LAMP.x - p.x) * t;
    const y = p.y + (LAMP.y - p.y) * t;
    const z = p.z + (LAMP.z - p.z) * t;
    const r = Math.hypot(x, z);
    let inside = 0;
    if (y < FLOOR + 0.36) inside = clamp01((0.5 - r + 0.07) / 0.14);
    else if (y < FLOOR + 0.92) inside = clamp01((0.17 - r + 0.05) / 0.1);
    worst = Math.max(worst, inside);
  }
  return 1 - 0.72 * smooth(worst);
}

/** The middle of the sanctum door, where the day's light comes in. */
const DOOR_LIGHT = new Vector3(0, 1.65, 2.6);
const DAY_RGB = [0.95, 0.96, 1.0] as const;
const SKY_RGB = [0.42, 0.44, 0.47] as const;
const DAY_GAIN = 2.3;
/** By day the lamp still burns, small beside the daylight. */
const DAY_LAMP = 0.3;

/** The lamp's light at p facing n, before colour. */
function lampTerm(p: Vector3, n: Vector3): number {
  const dx = LAMP.x - p.x;
  const dy = LAMP.y - p.y;
  const dz = LAMP.z - p.z;
  const d = Math.max(0.05, Math.hypot(dx, dy, dz));
  const ndl = (n.x * dx + n.y * dy + n.z * dz) / d;
  const wrap = clamp01((ndl + 0.25) / 1.25);
  return (LAMP_GAIN * wrap * lampReach(p)) / (1 + 0.15 * d * d);
}

/** Corners where wall meets floor or ceiling gather less light. */
function nookAt(p: Vector3): number {
  const wall = Math.min(INNER - Math.abs(p.x), INNER - Math.abs(p.z));
  return p.y < 0.95 || p.y > 3.95 ? 1 - 0.35 * (1 - smooth(clamp01(wall / 0.45))) : 1;
}

/** At night: the lamp, a little dim fill, and a faint glow from the hall at the door. */
function nightAt(p: Vector3, n: Vector3, ambient: number, out: number[]): void {
  const lamp = lampTerm(p, n);
  const nook = nookAt(p);
  const door = 0.22 * smooth(clamp01((p.z + 0.4) / 2.6));
  const fill = (1 + 3 * door) * ambient * nook;
  for (let k = 0; k < 3; k++)
    out[k] = (AMBIENT_RGB[k] ?? 0) * fill + (LAMP_RGB[k] ?? 0) * lamp * nook;
}

/**
 * By day: soft white daylight through the door, strongest on what faces it (the back wall and
 * the linga's niche) and on the floor near the threshold, a cool fill from the sky's bounce, and
 * the lamp as a small warm glow round itself.
 */
function dayAt(p: Vector3, n: Vector3, ambient: number, out: number[]): void {
  const dx = DOOR_LIGHT.x - p.x;
  const dy = DOOR_LIGHT.y - p.y;
  const dz = DOOR_LIGHT.z - p.z;
  const d = Math.max(0.05, Math.hypot(dx, dy, dz));
  const ndl = (n.x * dx + n.y * dy + n.z * dz) / d;
  const day = (DAY_GAIN * clamp01((ndl + 0.4) / 1.4)) / (1 + 0.08 * d * d);
  const lamp = DAY_LAMP * lampTerm(p, n);
  const nook = nookAt(p);
  const fill = Math.min(ambient, 1.4) * nook;
  for (let k = 0; k < 3; k++)
    out[k] =
      ((SKY_RGB[k] ?? 0) * fill + (DAY_RGB[k] ?? 0) * day) * nook + (LAMP_RGB[k] ?? 0) * lamp;
}

/** Triangles gathered with their normals and albedo; the light is baked in when built. */
class Sheet {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly alb: number[] = [];
  private readonly amb: number[] = [];

  constructor(
    private readonly textured: boolean,
    /** False for the flames: they are light, not lit. */
    private readonly baked = true,
  ) {}

  private vertex(p: Vector3, n: Vector3, c: Color, amb: number, uv?: readonly number[]): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.alb.push(c.r, c.g, c.b);
    this.amb.push(amb);
    if (this.textured) this.uv.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
  }

  /** A surface f(s, t) over s, t in 0..1, in nu × nv cells, facing n. */
  grid(
    f: (s: number, t: number) => Vector3,
    n: Vector3,
    nu: number,
    nv: number,
    c: Color,
    uv?: (s: number, t: number) => readonly number[],
    amb = 1,
  ): void {
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const s0 = i / nu;
        const s1 = (i + 1) / nu;
        const t0 = j / nv;
        const t1 = (j + 1) / nv;
        for (const [s, t] of [
          [s0, t0],
          [s1, t0],
          [s1, t1],
          [s0, t0],
          [s1, t1],
          [s0, t1],
        ] as const)
          this.vertex(f(s, t), n, c, amb, uv?.(s, t));
      }
    }
  }

  /** An axis-aligned box in cells of about `seg` metres; `skip` drops faces nobody sees. */
  box(min: Vector3, max: Vector3, c: Color, seg: number, skip: (n: Vector3) => boolean): void {
    const d = max.clone().sub(min);
    const cells = (len: number): number => Math.max(1, Math.ceil(len / seg));
    const faces: [Vector3, (s: number, t: number) => Vector3, number, number][] = [
      [
        new Vector3(1, 0, 0),
        (s, t) => new Vector3(max.x, min.y + t * d.y, min.z + s * d.z),
        d.z,
        d.y,
      ],
      [
        new Vector3(-1, 0, 0),
        (s, t) => new Vector3(min.x, min.y + t * d.y, min.z + s * d.z),
        d.z,
        d.y,
      ],
      [
        new Vector3(0, 1, 0),
        (s, t) => new Vector3(min.x + s * d.x, max.y, min.z + t * d.z),
        d.x,
        d.z,
      ],
      [
        new Vector3(0, -1, 0),
        (s, t) => new Vector3(min.x + s * d.x, min.y, min.z + t * d.z),
        d.x,
        d.z,
      ],
      [
        new Vector3(0, 0, 1),
        (s, t) => new Vector3(min.x + s * d.x, min.y + t * d.y, max.z),
        d.x,
        d.y,
      ],
      [
        new Vector3(0, 0, -1),
        (s, t) => new Vector3(min.x + s * d.x, min.y + t * d.y, min.z),
        d.x,
        d.y,
      ],
    ];
    for (const [n, f, a, b] of faces) {
      if (skip(n)) continue;
      this.grid(f, n, cells(a), cells(b), c, (s, t) => uvOf("plain", s, 0.25 + 0.5 * t));
    }
  }

  /** A three.js shape, moved by m, in one colour. */
  shape(geo: BufferGeometry, m: Matrix4, c: Color, amb = 1): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const pv = new Vector3();
    const nv = new Vector3();
    for (let i = 0; i < p.count; i++) {
      pv.fromBufferAttribute(p, i);
      if (n) nv.fromBufferAttribute(n, i).normalize();
      else nv.set(0, 1, 0);
      this.vertex(pv, nv, c, amb);
    }
    g.dispose();
    if (g !== geo) geo.dispose();
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(): BufferGeometry {
    // Two bakes: the night's lamp light in `color`, the day's in `colorDay` (see dayShader).
    const col: number[] = new Array<number>(this.alb.length);
    const colDay: number[] = new Array<number>(this.alb.length);
    const p = new Vector3();
    const n = new Vector3();
    const night = [1, 1, 1];
    const day = [1, 1, 1];
    for (let i = 0; i < this.amb.length; i++) {
      p.fromArray(this.pos, i * 3);
      n.fromArray(this.nor, i * 3);
      if (this.baked) {
        nightAt(p, n, this.amb[i] ?? 1, night);
        dayAt(p, n, this.amb[i] ?? 1, day);
      }
      for (let k = 0; k < 3; k++) {
        const a = this.alb[i * 3 + k] ?? 1;
        col[i * 3 + k] = a * (night[k] ?? 0);
        colDay[i * 3 + k] = a * (day[k] ?? 0);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new Float32BufferAttribute(col, 3));
    if (this.baked) geo.setAttribute("colorDay", new Float32BufferAttribute(colDay, 3));
    if (this.textured) geo.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
}

// --- The atlas ----------------------------------------------------------------------------------

const ATLAS = 1024;
/** Cells in atlas pixels: x, y (down), w, h. */
const CELLS = {
  back: [0, 0, 1024, 349], // the west wall's body, 4.4 × 1.5 m
  side: [0, 349, 1024, 349], // the north and south walls' bodies
  frieze: [0, 698, 1024, 58], // 4.4 × 0.25 m
  petals: [0, 756, 1024, 47], // 4.4 × 0.2 m
  floor: [0, 803, 221, 221], // a quarter of the floor, the room's centre at its top-left
  ceiling: [221, 803, 221, 221], // a quarter of the ceiling, the same way
  upper: [442, 803, 582, 190], // the upper walls, 4.4 × 1.31 m
  plain: [442, 993, 582, 31], // pale grained stone, tinted by vertex colour on the mouldings
} as const;
type CellName = keyof typeof CELLS;

/** A point in a cell (a across, b down, both 0..1) as a UV, kept 1.5 px inside the cell's edge. */
function uvOf(cell: CellName, a: number, b: number): readonly number[] {
  const [x, y, w, h] = CELLS[cell];
  const pad = 1.5;
  const px = x + pad + clamp01(a) * (w - 2 * pad);
  const py = y + pad + clamp01(b) * (h - 2 * pad);
  return [px / ATLAS, 1 - py / ATLAS];
}

// --- The walls ----------------------------------------------------------------------------------

/**
 * One inner wall: `a` runs to the right of a visitor facing it, `d` out from its face into the
 * room. The back (west) wall's ends sit inside the side walls' mouldings, so the side walls start
 * where the back wall's moulding of the same depth ends.
 */
interface Wall {
  n: Vector3;
  cell: "back" | "side";
  point(a: number, y: number, d: number): Vector3;
  range(d: number): [number, number];
}

const WALLS: readonly Wall[] = [
  {
    n: new Vector3(0, 0, 1),
    cell: "back",
    point: (a, y, d) => new Vector3(a, y, -INNER + d),
    range: (d) => [-(INNER - d), INNER - d],
  },
  {
    n: new Vector3(-1, 0, 0),
    cell: "side",
    point: (a, y, d) => new Vector3(INNER - d, y, a),
    range: (d) => [-INNER + d, INNER],
  },
  {
    n: new Vector3(1, 0, 0),
    cell: "side",
    point: (a, y, d) => new Vector3(-INNER + d, y, -a),
    range: (d) => [-INNER, INNER - d],
  },
];

function wallFace(
  sheet: Sheet,
  w: Wall,
  y0: number,
  y1: number,
  d: number,
  cell: CellName,
  seg: number,
): void {
  const [a0, a1] = w.range(d);
  sheet.grid(
    (s, t) => w.point(a0 + (a1 - a0) * s, y1 - (y1 - y0) * t, d),
    w.n,
    Math.ceil((a1 - a0) / seg),
    Math.max(1, Math.ceil((y1 - y0) / seg)),
    ALBEDO.white,
    (s, t) => uvOf(cell, (a0 + (a1 - a0) * s + INNER) / (2 * INNER), t),
  );
}

function wallBox(
  sheet: Sheet,
  w: Wall,
  y0: number,
  y1: number,
  d: number,
  c: Color,
  seg: number,
): void {
  const [a0, a1]: [number, number] = w.cell === "back" ? [-INNER, INNER] : w.range(d);
  const p = w.point(a0, y0, 0);
  const q = w.point(a1, y1, d);
  const min = new Vector3(Math.min(p.x, q.x), y0, Math.min(p.z, q.z));
  const max = new Vector3(Math.max(p.x, q.x), y1, Math.max(p.z, q.z));
  const back = w.n.clone().negate();
  sheet.box(
    min,
    max,
    c,
    seg,
    (n) => n.equals(back) || (n.y < 0 && y0 <= FLOOR + 1e-4) || isSideEnd(w, n),
  );
}

/**
 * Hidden ends: a side wall's moulding ends against the back wall's, and the back wall's ends lie
 * flat against the side walls.
 */
function isSideEnd(w: Wall, n: Vector3): boolean {
  return w.cell === "side" ? n.z < -0.5 : Math.abs(n.x) > 0.5;
}

// --- Building ------------------------------------------------------------------------------------

export class SanctumInterior {
  readonly group = new Group();
  /** 1 when still; the lamp's flicker otherwise. The sanctum light follows it. */
  flicker = 1;
  private time = 0;
  private readonly lit: MeshBasicMaterial[] = [];
  /** 0 at night, 1 by day: blends the two bakes on the GPU. */
  private readonly day = { value: 0 };
  private flames: Mesh | null = null;

  constructor(lite: boolean) {
    this.group.name = "sanctum-interior";
    // No DOM (the unit tests): nothing to draw on, so the sanctum stays as the model has it.
    if (typeof document === "undefined") return;
    const seg = lite ? 0.55 : 0.32;

    const atlas = canvasOf(ATLAS, ATLAS, paintAtlas, lite ? 0.5 : 1);
    if (atlas) {
      const stone = new Sheet(true);
      for (const w of WALLS) {
        wallFace(stone, w, BODY.y0, BODY.y1, SKIN, w.cell, seg);
        wallFace(stone, w, FRIEZE.y0, FRIEZE.y1, SKIN, "frieze", seg);
        wallFace(stone, w, UPPER.y0, UPPER.y1, SKIN, "upper", seg);
        wallFace(stone, w, PETAL_BAND.y0, PETAL_BAND.y1, PETAL_BAND.d + 0.002, "petals", seg);
        for (const m of MOULDINGS) wallBox(stone, w, m.y0, m.y1, m.d, ALBEDO[m.tone], seg);
      }
      // Floor and ceiling in four mirrored quarters, finer on the floor for the linga's shadow.
      const fine = lite ? 0.2 : 0.12;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          stone.grid(
            (s, t) => new Vector3(sx * s * INNER, FLOOR + 0.004, sz * t * INNER),
            new Vector3(0, 1, 0),
            Math.ceil(INNER / fine),
            Math.ceil(INNER / fine),
            ALBEDO.white,
            (s, t) => uvOf("floor", s, t),
          );
          stone.grid(
            (s, t) => new Vector3(sx * s * INNER, CEIL, sz * t * INNER),
            new Vector3(0, -1, 0),
            Math.ceil(INNER / seg),
            Math.ceil(INNER / seg),
            ALBEDO.white,
            (s, t) => uvOf("ceiling", s, t),
          );
        }
      }
      const map = new CanvasTexture(atlas);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = lite ? 1 : 4;
      if (lite) {
        // Free the canvas once the GPU has its copy (as the wall paintings do).
        map.onUpdate = () => {
          atlas.width = 1;
          atlas.height = 1;
          map.onUpdate = null;
        };
      }
      const material = new MeshBasicMaterial({ map, vertexColors: true, side: DoubleSide });
      this.dayShader(material);
      const mesh = new Mesh(stone.build(), material);
      mesh.name = "sanctum-stone";
      this.group.add(mesh);
    }

    const props = new Sheet(false);
    channel(props);
    garland(props);
    for (const [x, z, turn] of [
      [-1.62, -1.62, 0.4],
      [1.62, -1.62, 2.1],
    ] as const)
      kalash(props, x, z, turn);
    const flames = hangingLamp(props, lite);
    const propMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.dayShader(propMaterial);
    const propMesh = new Mesh(props.build(), propMaterial);
    propMesh.name = "sanctum-props";
    this.group.add(propMesh);

    const flameMesh = new Mesh(
      flames,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    flameMesh.name = "sanctum-flames";
    flameMesh.position.set(SANCTUM_LAMP.x, SANCTUM_LAMP.y, SANCTUM_LAMP.z);
    this.flames = flameMesh;
    this.group.add(flameMesh);
  }

  /** How much daylight comes in at the door, 0 (night) to 1 (day), from the sky's look. */
  setDaylight(k: number): void {
    this.day.value = clamp01(k);
  }

  /**
   * The lamp's slow, uneven flicker; still with reduced motion. By day the daylight steadies the
   * room, so only the flames themselves (and a trace of it on the stone) still move.
   */
  update(dt: number, still: boolean): void {
    let f = 1;
    if (!still) {
      this.time += dt;
      const t = this.time;
      f =
        1 +
        0.035 * Math.sin(t * 6.3) +
        0.022 * Math.sin(t * 11.9 + 1.3) +
        0.014 * Math.sin(t * 23.1 + 0.4);
    }
    this.flicker = 1 + (f - 1) * (1 - 0.85 * this.day.value);
    for (const m of this.lit) m.color.setScalar(this.flicker);
    if (this.flames) this.flames.scale.set(1, 1 + (f - 1) * 2.4, 1);
  }

  /** Blends the night bake (`color`) towards the day bake (`colorDay`) by `day`. */
  private dayShader(m: MeshBasicMaterial): void {
    this.lit.push(m);
    const day = this.day;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDay = day;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute vec3 colorDay;\nuniform float uDay;",
        )
        .replace(
          "#include <color_vertex>",
          "#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = mix(color.rgb, colorDay, uDay);\n#endif",
        );
    };
  }
}

// --- Props -----------------------------------------------------------------------------------------

const v2 = (x: number, y: number): Vector2 => new Vector2(x, y);
const at = (x: number, y: number, z: number, yaw = 0, s = 1): Matrix4 =>
  new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    new Vector3(s, s, s),
  );

/** The abhisheka channel: from beside the pitha's spout (north, +x) to the north wall. */
function channel(p: Sheet): void {
  const x0 = 0.9;
  const x1 = INNER - PLINTH_COURSE.d;
  const top = FLOOR + 0.03;
  for (const s of [-1, 1]) {
    const z0 = s * 0.055;
    const z1 = s * 0.1;
    p.box(
      new Vector3(x0, FLOOR, Math.min(z0, z1)),
      new Vector3(x1, top, Math.max(z0, z1)),
      ALBEDO.stoneDark,
      0.3,
      (n) => n.y < 0,
    );
  }
  // A short curved lip where it starts, the wet stone in it, and the mouth in the wall's base.
  p.box(
    new Vector3(x0 - 0.05, FLOOR, -0.1),
    new Vector3(x0, top, 0.1),
    ALBEDO.stoneDark,
    0.3,
    (n) => n.y < 0,
  );
  p.grid(
    (s, t) => new Vector3(x0 + (x1 - x0) * s, FLOOR + 0.008, -0.055 + 0.11 * t),
    new Vector3(0, 1, 0),
    4,
    1,
    ALBEDO.wet,
  );
  p.grid(
    (s, t) => new Vector3(x1 - 0.002, FLOOR + 0.075 * t, -0.055 + 0.11 * s),
    new Vector3(-1, 0, 0),
    1,
    1,
    ALBEDO.hole,
  );
}

/** Marigolds and jasmine in a swag across the niche's arch, with a strand down each side. */
function garland(p: Sheet): void {
  const flowerGeo = (r: number): BufferGeometry => {
    const g = new OctahedronGeometry(1, 0);
    g.scale(r, r * 0.78, r);
    return g;
  };
  const colour = (i: number): Color =>
    i % 3 === 2 ? ALBEDO.jasmine : i % 6 === 1 ? ALBEDO.yellow : ALBEDO.marigold;
  const span = 0.9;
  const top = 2.27;
  const sag = 0.24;
  const wallZ = -INNER + SKIN;
  // The swag: spaced evenly along its length.
  const pts: Vector3[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const u = 2 * t - 1;
    pts.push(
      new Vector3(-span + 2 * span * t, top - sag * (1 - u * u), wallZ + 0.04 + 0.03 * (1 - u * u)),
    );
  }
  let carry = 0;
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    carry += a.distanceTo(b);
    if (carry < 0.036) continue;
    carry = 0;
    const r = colour(k) === ALBEDO.jasmine ? 0.014 : 0.021;
    p.shape(flowerGeo(r), at(b.x, b.y, b.z, k * 0.7), colour(k++));
  }
  // The strands, each ending in a bigger marigold, and the brass hooks they hang from.
  for (const s of [-1, 1]) {
    for (let j = 0; j < 13; j++) {
      const y = top - 0.035 * j;
      const r = j === 12 ? 0.03 : colour(j) === ALBEDO.jasmine ? 0.014 : 0.021;
      p.shape(
        flowerGeo(r),
        at(s * span, y, wallZ + 0.04, j * 0.9),
        j === 12 ? ALBEDO.marigold : colour(j),
      );
    }
    const hook = new CylinderGeometry(0.012, 0.012, 0.05, 6);
    hook.rotateX(Math.PI / 2);
    p.shape(hook, at(s * span, top + 0.02, wallZ + 0.02), ALBEDO.brass);
  }
}

/** A purna kalash: copper pot on a stone ring, red thread, five mango leaves and a coconut. */
function kalash(p: Sheet, x: number, z: number, turn: number): void {
  p.shape(new CylinderGeometry(0.15, 0.165, 0.045, 14), at(x, FLOOR + 0.0225, z), ALBEDO.stoneDark);
  const base = FLOOR + 0.03;
  const pot = new LatheGeometry(
    [
      v2(0, 0),
      v2(0.06, 0.004),
      v2(0.11, 0.03),
      v2(0.138, 0.075),
      v2(0.145, 0.115),
      v2(0.132, 0.165),
      v2(0.095, 0.21),
      v2(0.057, 0.238),
      v2(0.052, 0.252),
      v2(0.068, 0.268),
      v2(0.073, 0.278),
      v2(0.06, 0.282),
    ],
    16,
  );
  p.shape(pot, at(x, base, z, turn), ALBEDO.copper);
  const thread = new TorusGeometry(0.143, 0.005, 3, 20);
  thread.rotateX(Math.PI / 2);
  p.shape(thread, at(x, base + 0.105, z), ALBEDO.thread);
  // Mango leaves: a folded blade each, splayed out over the rim and drooping a little.
  for (let i = 0; i < 5; i++) {
    const yaw = turn + (i / 5) * TAU;
    const leafGeo = new BufferGeometry();
    const L = 0.15;
    const W = 0.028;
    // Base, two edges and the tip; the midrib rides 6 mm above the edges.
    const pos = [0, 0.006, 0, W, 0, L * 0.4, 0, 0.006, L, 0, 0.006, 0, 0, 0.006, L, -W, 0, L * 0.4];
    leafGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    leafGeo.computeVertexNormals();
    const m = new Matrix4()
      .makeTranslation(x, base + 0.276, z)
      .multiply(new Matrix4().makeRotationY(yaw))
      .multiply(new Matrix4().makeRotationX(0.38))
      .multiply(new Matrix4().makeTranslation(0, 0, 0.035));
    p.shape(leafGeo, m, ALBEDO.leaf);
  }
  const nut = new SphereGeometry(0.068, 10, 7);
  nut.scale(1, 1.2, 1);
  p.shape(nut, at(x, base + 0.335, z), ALBEDO.coconut);
  p.shape(new ConeGeometry(0.022, 0.05, 6), at(x, base + 0.425, z), ALBEDO.husk);
}

/**
 * A brass hanging lamp (latkan deepa): a shallow oil bowl with five spouts, a bead rim and a bud
 * below, three rods up to a small dome, and a chain to a plate in the ceiling. The flames go in
 * their own geometry, round the lamp's centre at their own height.
 */
function hangingLamp(p: Sheet, lite: boolean): BufferGeometry {
  const { x: X, y: F, z: Z } = SANCTUM_LAMP;
  const glow = 2.4; // the flames light their own lamp from close by
  p.shape(
    new LatheGeometry(
      [
        v2(0, -0.085),
        v2(0.05, -0.082),
        v2(0.1, -0.062),
        v2(0.14, -0.035),
        v2(0.165, -0.012),
        v2(0.175, 0),
        v2(0.162, 0.002),
        v2(0.12, -0.02),
        v2(0.06, -0.034),
        v2(0, -0.038),
      ],
      lite ? 14 : 22,
    ),
    at(X, F, Z),
    ALBEDO.brass,
    glow,
  );
  const rim = new TorusGeometry(0.172, 0.007, 4, lite ? 16 : 26);
  rim.rotateX(Math.PI / 2);
  p.shape(rim, at(X, F, Z), ALBEDO.brass, glow);
  p.shape(
    new LatheGeometry(
      [
        v2(0, -0.225),
        v2(0.012, -0.218),
        v2(0.03, -0.185),
        v2(0.034, -0.155),
        v2(0.02, -0.125),
        v2(0.03, -0.105),
        v2(0.042, -0.09),
        v2(0, -0.084),
      ],
      10,
    ),
    at(X, F, Z),
    ALBEDO.brass,
    glow,
  );

  // Five spouts, one facing the door; a flame on each.
  const flames = new Sheet(false, false);
  const flameColour = new Color("#ff9a3c");
  const coreColour = new Color("#ffe6a8");
  for (let i = 0; i < 5; i++) {
    const th = Math.PI / 2 + (i / 5) * TAU;
    const dx = Math.cos(th);
    const dz = Math.sin(th);
    const spout = new ConeGeometry(0.03, 0.085, 6);
    spout.rotateZ(-Math.PI / 2);
    spout.scale(1, 0.45, 1);
    p.shape(spout, at(X + dx * 0.2, F - 0.004, Z + dz * 0.2, -th), ALBEDO.brass, glow);
    const flame = (r: number, h: number): LatheGeometry =>
      new LatheGeometry(
        [
          v2(0, 0),
          v2(r * 0.65, h * 0.1),
          v2(r, h * 0.34),
          v2(r * 0.72, h * 0.62),
          v2(r * 0.3, h * 0.86),
          v2(0, h),
        ],
        8,
      );
    flames.shape(flame(0.013, 0.062), at(dx * 0.232, 0.002, dz * 0.232), flameColour, 6);
    flames.shape(flame(0.006, 0.032), at(dx * 0.232, 0.004, dz * 0.232), coreColour, 6);
  }

  // Three rods from the rim to a little dome, with beads on them.
  const apex = new Vector3(X, F + 0.34, Z);
  for (let i = 0; i < 3; i++) {
    const th = Math.PI / 6 + (i / 3) * TAU;
    const foot = new Vector3(X + Math.cos(th) * 0.168, F + 0.006, Z + Math.sin(th) * 0.168);
    const dir = apex.clone().sub(foot);
    const len = dir.length();
    const rod = new CylinderGeometry(0.0035, 0.0035, len, 4);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    const mid = foot.clone().addScaledVector(dir, 0.5);
    p.shape(rod, new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), ALBEDO.brass, glow);
    for (const t of [0.25, 0.5, 0.75]) {
      const b = foot.clone().addScaledVector(dir, t);
      p.shape(new OctahedronGeometry(0.008, 0), at(b.x, b.y, b.z), ALBEDO.brass, glow);
    }
  }
  p.shape(
    new LatheGeometry(
      [
        v2(0, 0.33),
        v2(0.036, 0.336),
        v2(0.046, 0.352),
        v2(0.032, 0.39),
        v2(0.016, 0.418),
        v2(0.021, 0.428),
        v2(0, 0.44),
      ],
      lite ? 8 : 12,
    ),
    at(X, F, Z),
    ALBEDO.brass,
    1.4,
  );

  // The chain: links turned alternately a quarter turn, up to a round plate in the ceiling.
  const linkLen = 0.05;
  const from = F + 0.44;
  const n = Math.floor((CEIL - 0.02 - from) / linkLen);
  for (let i = 0; i < n; i++) {
    const link = new TorusGeometry(0.016, 0.004, 3, lite ? 5 : 7);
    link.scale(1, 1.7, 1);
    p.shape(link, at(X, from + linkLen * (i + 0.5), Z, i % 2 ? Math.PI / 2 : 0), ALBEDO.brass);
  }
  p.shape(new CylinderGeometry(0.05, 0.065, 0.025, 12), at(X, CEIL - 0.0125, Z), ALBEDO.brass);

  return flames.build();
}

// --- Painting (canvas y runs down; each cell is painted in its own pixels) ------------------------

function paintAtlas(ctx: Ctx): void {
  const rnd = seeded(2208);
  const painters: Record<CellName, (c: Ctx, w: number, h: number) => void> = {
    back: (c, w, h) => paintBack(c, w, h, rnd),
    side: (c, w, h) => paintSide(c, w, h, rnd),
    frieze: (c, w, h) => paintFrieze(c, w, h, rnd),
    petals: (c, w, h) => paintPetals(c, w, h),
    floor: (c, w, h) => paintFloor(c, w, h, rnd),
    ceiling: (c, w, h) => paintCeiling(c, w, h),
    upper: (c, w, h) => {
      // Painted at the wall's own proportions (4.4 × 1.31 m at 233 px/m), then fitted.
      c.scale(w / 1024, h / 305);
      ashlar(c, 0, 0, 1024, 305, rnd, 72);
      soot(c, 1024, 305, 0.62, 0.2);
    },
    plain: (c, w, h) => {
      c.fillStyle = "#e4ded3";
      c.fillRect(0, 0, w, h);
      grain(c, 0, 0, w, h, rnd, 0.1);
    },
  };
  for (const name of Object.keys(CELLS) as CellName[]) {
    const [x, y, w, h] = CELLS[name];
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    painters[name](ctx, w, h);
    ctx.restore();
  }
}

/** 233 px to the metre on the walls. */
const PX = 1024 / (2 * INNER);

/** The west wall behind the linga: the carved niche frame, rosettes, pilasters and lattices. */
function paintBack(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  ashlar(ctx, 0, 0, w, h, rnd, 70);
  const cx = w / 2;
  for (const s of [-1, 1]) {
    pilaster(ctx, cx + s * 1.36 * PX, 4, h, 70);
    rosette(ctx, cx + s * 1.03 * PX, 108, 31);
    rosette(ctx, cx + s * 1.03 * PX, 246, 31);
    lattice(ctx, cx + s * 1.8 * PX - 58, 54, 116, 236);
  }
  niche(ctx, cx, h, 0.86 * PX);
  soot(ctx, w, h, 0.5, 0.3);
  kumkum(
    ctx,
    rnd,
    [cx - 0.86 * PX + 10, cx + 0.86 * PX - 10, cx - 1.36 * PX, cx + 1.36 * PX],
    h - 14,
  );
}

/** The north and south walls: a lattice window in the middle between pilasters, and rosettes. */
function paintSide(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  ashlar(ctx, 0, 0, w, h, rnd, 70);
  const cx = w / 2;
  lattice(ctx, cx - 120, 40, 240, 262);
  for (const s of [-1, 1]) {
    pilaster(ctx, cx + s * 0.88 * PX, 4, h, 64);
    rosette(ctx, cx + s * 1.3 * PX, 112, 29);
    rosette(ctx, cx + s * 1.3 * PX, 244, 29);
    pilaster(ctx, cx + s * 1.72 * PX, 4, h, 56);
  }
  soot(ctx, w, h, 0.5, 0.25);
  kumkum(ctx, rnd, [cx - 0.88 * PX, cx + 0.88 * PX], h - 14);
}

/** The painted frieze: geru red between lime-white rules, marigolds and bel sprigs in turn. */
function paintFrieze(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  ctx.fillStyle = PAINT.geru;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PAINT.white;
  ctx.fillRect(0, 4, w, 2.5);
  ctx.fillRect(0, h - 6.5, w, 2.5);
  // A row of small hanging triangles under the top rule.
  ctx.beginPath();
  for (let x = 0; x < w; x += 12) {
    ctx.moveTo(x, 7);
    ctx.lineTo(x + 12, 7);
    ctx.lineTo(x + 6, 13);
    ctx.closePath();
  }
  ctx.fill();
  let i = 0;
  for (let x = 22; x < w; x += 44, i++) {
    if (i % 2) flower(ctx, x, h * 0.6, 8.5);
    else belLeaf(ctx, x, h * 0.78, 9);
    ctx.fillStyle = PAINT.white;
    dot(ctx, x + 22, h * 0.6, 2.4);
    dot(ctx, x + 22, h * 0.6 - 7, 1.4);
    dot(ctx, x + 22, h * 0.6 + 7, 1.4);
  }
  age(ctx, w, h, rnd);
  ctx.fillStyle = "rgba(20,12,6,0.22)"; // lamp smoke dulls it
  ctx.fillRect(0, 0, w, h);
}

/** The base moulding's band: a bead row over upright lotus petals, carved. */
function paintPetals(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = STONE.dark;
  ctx.fillRect(0, 0, w, h);
  carve(ctx, rectPath(ctx, 0, 0, w, 10), STONE.light, 1.5);
  for (let x = 4.5; x < w; x += 9) {
    carve(ctx, () => circlePath(ctx, x, 5, 3), STONE.base, 1);
  }
  for (let x = -4; x < w; x += 30) {
    carve(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(x + 1, h);
        ctx.quadraticCurveTo(x - 1, 19, x + 15, 13);
        ctx.quadraticCurveTo(x + 31, 19, x + 29, h);
        ctx.closePath();
      },
      STONE.light,
      2,
    );
    // The midrib, cut in.
    ctx.strokeStyle = "rgba(25,18,12,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 15, 18);
    ctx.lineTo(x + 15, h - 4);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(20,12,6,0.18)";
  ctx.fillRect(0, 0, w, h);
}

/** A quarter of the floor, the room's centre at the top-left corner, 100 px to the metre. */
function paintFloor(ctx: Ctx, w: number, h: number, rnd: () => number): void {
  const P = w / INNER;
  ctx.fillStyle = STONE.joint;
  ctx.fillRect(0, 0, w, h);
  // Dressed slabs in a ring; edges from the centre line out, so the four quarters meet as one.
  const edges = [0, 0.33, 0.66, 1.105, 1.55];
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = 0; j < edges.length - 1; j++) {
      const x0 = edges[i] ?? 0;
      const x1 = edges[i + 1] ?? 0;
      const z0 = edges[j] ?? 0;
      const z1 = edges[j + 1] ?? 0;
      if (x0 < 0.6 && z0 < 0.6) continue;
      slab(
        ctx,
        x0 * P,
        z0 * P,
        (x1 - x0) * P,
        (z1 - z0) * P,
        rnd,
        i === 0 ? 0 : 1.2,
        j === 0 ? 0 : 1.2,
      );
    }
  }
  // The border: a dark band set with pale diamonds, a rosette at the corner.
  ctx.fillStyle = STONE.floorDark;
  ctx.fillRect(0, 1.56 * P, 1.9 * P, 0.34 * P);
  ctx.fillRect(1.56 * P, 0, 0.34 * P, 1.9 * P);
  ctx.fillStyle = STONE.brass;
  ctx.fillRect(0, 1.56 * P, 1.56 * P + 1.5, 1.5);
  ctx.fillRect(1.56 * P, 0, 1.5, 1.56 * P);
  ctx.fillRect(0, 1.9 * P - 1.5, 1.9 * P, 1.5);
  ctx.fillRect(1.9 * P - 1.5, 0, 1.5, 1.9 * P);
  ctx.fillStyle = STONE.inlay;
  for (let c = 0.1; c < 1.5; c += 0.2) {
    diamond(ctx, c * P, 1.73 * P, 0.075 * P);
    diamond(ctx, 1.73 * P, c * P, 0.075 * P);
  }
  ctx.fillStyle = STONE.inlay;
  for (let k = 0; k < 8; k++) {
    ctx.save();
    ctx.translate(1.73 * P, 1.73 * P);
    ctx.rotate((k / 8) * TAU);
    ctx.beginPath();
    ctx.ellipse(0, -0.07 * P, 0.025 * P, 0.07 * P, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = STONE.brass;
  dot(ctx, 1.73 * P, 1.73 * P, 0.03 * P);
  // Along the walls, long plain slabs (mostly under the base moulding).
  for (let a = 0; a < 2.2; a += 0.55) {
    slab(ctx, a * P, 1.9 * P, 0.55 * P, 0.3 * P, rnd, a === 0 ? 0 : 1.2, 1.2);
    slab(ctx, 1.9 * P, a * P, 0.3 * P, 0.55 * P, rnd, 1.2, a === 0 ? 0 : 1.2);
  }
  // The centre slab under the pitha: polished dark stone, always a little wet; a brass line round it.
  ctx.fillStyle = STONE.floorDark;
  ctx.fillRect(0, 0, 0.6 * P, 0.6 * P);
  const wet = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.85 * P);
  wet.addColorStop(0, "rgba(255,225,180,0.10)");
  wet.addColorStop(0.55, "rgba(255,225,180,0.04)");
  wet.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wet;
  ctx.fillRect(0, 0, 0.6 * P, 0.6 * P);
  ctx.fillStyle = STONE.brass;
  ctx.fillRect(0, 0.6 * P, 0.6 * P + 3, 2.5);
  ctx.fillRect(0.6 * P, 0, 2.5, 0.6 * P + 3);
  // Darker, worn stone round the pitha where water and flowers fall.
  const worn = ctx.createRadialGradient(0, 0, 0.4 * P, 0, 0, 1.3 * P);
  worn.addColorStop(0, "rgba(10,7,4,0.28)");
  worn.addColorStop(1, "rgba(10,7,4,0)");
  ctx.fillStyle = worn;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, 0, 0, w, h, rnd, 0.06);
}

/** A quarter of the ceiling: a carved lotus in a square coffer, framed by beams. */
function paintCeiling(ctx: Ctx, w: number, h: number): void {
  const P = w / INNER;
  ctx.fillStyle = STONE.deep;
  ctx.fillRect(0, 0, w, h);
  carve(ctx, rectPath(ctx, 1.84 * P, 0, w, h), STONE.dark, 2);
  carve(ctx, rectPath(ctx, 0, 1.84 * P, w, h), STONE.dark, 2);
  carve(ctx, rectPath(ctx, 1.62 * P, 0, 0.12 * P, 1.74 * P), STONE.base, 1.5);
  carve(ctx, rectPath(ctx, 0, 1.62 * P, 1.74 * P, 0.12 * P), STONE.base, 1.5);
  // The lotus: a ring disc, two rings of petals, and a boss.
  carve(ctx, () => circlePath(ctx, 0, 0, 1.08 * P), STONE.dark, 2);
  const ring = (n: number, r0: number, len: number, wid: number, fill: string): void => {
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * (Math.PI / 2);
      carve(ctx, () => petalPath(ctx, 0, 0, a, r0 * P, len * P, wid * P), fill, 2);
    }
  };
  ring(6, 0.55, 0.48, 0.13, STONE.light);
  ring(3, 0.24, 0.36, 0.13, STONE.base);
  carve(ctx, () => circlePath(ctx, 0, 0, 0.26 * P), STONE.light, 2);
  carve(ctx, () => circlePath(ctx, 0, 0, 0.16 * P), STONE.base, 1.5);
  carve(ctx, () => circlePath(ctx, 0, 0, 0.07 * P), STONE.light, 1);
  // A small rosette in the coffer's corner.
  for (let i = 0; i < 8; i++) {
    carve(
      ctx,
      () => petalPath(ctx, 1.38 * P, 1.38 * P, (i / 8) * TAU, 0.04 * P, 0.16 * P, 0.06 * P),
      STONE.base,
      1.2,
    );
  }
  // Soot from the lamp, heaviest overhead.
  const s = ctx.createRadialGradient(0, 1.05 * P, 0, 0, 1.05 * P, 1.2 * P);
  s.addColorStop(0, "rgba(12,8,5,0.55)");
  s.addColorStop(1, "rgba(12,8,5,0.15)");
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, w, h);
}

// --- Elements ------------------------------------------------------------------------------------

/**
 * The niche behind the linga: a carved frame with a vine scroll up both sides and along the top,
 * and a cusped arch opening onto a geru-red ground with lime-white bel sprigs and dotted borders.
 */
function niche(ctx: Ctx, cx: number, h: number, half: number): void {
  const x0 = cx - half;
  const x1 = cx + half;
  const top = 6;
  carve(ctx, rectPath(ctx, x0, top, 2 * half, h - top + 4), STONE.light, 3);
  const band = 24;
  sunk(ctx, rectPath(ctx, x0 + 4, top + 4, band, h - top), STONE.deep, 2);
  sunk(ctx, rectPath(ctx, x1 - 4 - band, top + 4, band, h - top), STONE.deep, 2);
  sunk(
    ctx,
    rectPath(ctx, x0 + 4 + band, top + 4, 2 * half - 8 - 2 * band, band - 2),
    STONE.deep,
    2,
  );
  scroll(ctx, x0 + 4 + band / 2, top + 4, h, true);
  scroll(ctx, x1 - 4 - band / 2, top + 4, h, true);
  scroll(ctx, top + 4 + (band - 2) / 2, x0 + 4 + band, x1 - 4 - band, false);

  // The opening under a cusped arch.
  const ix0 = x0 + band + 14;
  const ix1 = x1 - band - 14;
  const spring = 96;
  const apex = top + band + 16;
  const lobes = 7;
  const archPath = (inset: number): void => {
    ctx.beginPath();
    ctx.moveTo(ix0 + inset, h + 2);
    ctx.lineTo(ix0 + inset, spring);
    const centreY = spring + 60;
    let px = ix0 + inset;
    let py = spring;
    for (let i = 1; i <= lobes; i++) {
      const t = i / lobes;
      const nx = ix0 + inset + (ix1 - ix0 - 2 * inset) * t;
      const ny = spring - (spring - apex - inset) * Math.sin(Math.PI * t);
      const mx = (px + nx) / 2;
      const my = (py + ny) / 2;
      const ox = mx - cx;
      const oy = my - centreY;
      const ol = Math.hypot(ox, oy) || 1;
      ctx.quadraticCurveTo(mx + (ox / ol) * 13, my + (oy / ol) * 13, nx, ny);
      px = nx;
      py = ny;
    }
    ctx.lineTo(ix1 - inset, h + 2);
    ctx.closePath();
  };
  // Spandrels: a rosette each side of the arch, and a lotus bud over its crown.
  rosette(ctx, ix0 + 26, top + band + 30, 15);
  rosette(ctx, ix1 - 26, top + band + 30, 15);
  carve(ctx, () => petalPath(ctx, cx, apex - 2, -Math.PI / 2, 0, 15, 7), STONE.light, 1.5);
  // The cut edge of the arch, then the painted ground inside it.
  ctx.save();
  archPath(0);
  ctx.fillStyle = "rgba(15,10,6,0.6)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(2, 4);
  archPath(3);
  ctx.fillStyle = STONE.niche;
  ctx.fill();
  ctx.restore();
  ctx.save();
  archPath(3);
  ctx.clip();
  // Lamp light falls warmest in the middle, where the linga stands.
  const g = ctx.createRadialGradient(cx, h * 0.62, 10, cx, h * 0.62, half);
  g.addColorStop(0, "rgba(255,190,120,0.22)");
  g.addColorStop(1, "rgba(40,8,4,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(ix0, apex, ix1 - ix0, h);
  // Bel sprigs in lime white, in a staggered lattice.
  ctx.fillStyle = PAINT.white;
  ctx.globalAlpha = 0.75;
  let row = 0;
  for (let y = spring - 26; y < h + 20; y += 44, row++) {
    for (let x = ix0 + (row % 2 ? 22 : 44); x < ix1; x += 44) trefoil(ctx, x, y, 8);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // A dotted lime-white line just inside the arch.
  ctx.save();
  ctx.translate(2, 4);
  archPath(12);
  ctx.setLineDash([2, 6]);
  ctx.lineCap = "round";
  ctx.strokeStyle = PAINT.white;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/** A running vine carved in a band: along y (vertical) or along x, from a to b. */
function scroll(ctx: Ctx, c: number, a: number, b: number, vertical: boolean): void {
  const path = (): void => {
    ctx.beginPath();
    for (let u = a; u <= b; u += 2) {
      const o = Math.sin(((u - a) / 30) * Math.PI) * 6;
      if (vertical) {
        if (u === a) ctx.moveTo(c + o, u);
        else ctx.lineTo(c + o, u);
      } else if (u === a) ctx.moveTo(u, c + o);
      else ctx.lineTo(u, c + o);
    }
  };
  carveStroke(ctx, path, STONE.light, 2.6);
  // A curl and a leaf in each bend.
  for (let u = a + 15, k = 0; u < b - 6; u += 30, k++) {
    const side = k % 2 ? 1 : -1;
    const [x, y] = vertical ? [c + side * 6, u] : [u, c + side * 6];
    carveStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.arc(
          x - (vertical ? side * 2 : 0),
          y + (vertical ? 0 : -side * 2),
          4.2,
          0,
          Math.PI * 1.5,
        );
      },
      STONE.light,
      1.6,
    );
    const ang = vertical ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    carve(ctx, () => petalPath(ctx, x, y, ang, 1, 7, 3), STONE.base, 1);
  }
}

/** A carved pilaster: stepped base, fluted shaft with a bead band, pot-and-foliage capital. */
function pilaster(ctx: Ctx, cx: number, top: number, bot: number, w: number): void {
  const x0 = cx - w / 2;
  const shaftTop = top + 50;
  const shaftBot = bot - 34;
  carve(ctx, rectPath(ctx, x0 - 8, bot - 22, w + 16, 24), STONE.light, 2.5);
  carve(ctx, rectPath(ctx, x0 - 4, bot - 34, w + 8, 12), STONE.base, 2);
  carve(ctx, rectPath(ctx, x0, shaftTop, w, shaftBot - shaftTop), STONE.light, 2.5);
  for (const f of [0.28, 0.5, 0.72]) {
    sunk(
      ctx,
      rectPath(ctx, x0 + w * f - 3, shaftTop + 14, 6, shaftBot - shaftTop - 28),
      STONE.dark,
      1.5,
    );
  }
  const my = (shaftTop + shaftBot) / 2;
  carve(ctx, rectPath(ctx, x0 - 2, my - 7, w + 4, 14), STONE.base, 2);
  for (let i = 0; i < 6; i++)
    carve(ctx, () => circlePath(ctx, x0 + ((i + 0.5) * w) / 6, my, 3.4), STONE.light, 1);
  // Capital: a pot with leaves spilling from its mouth, under two blocks.
  const py = shaftTop - 8;
  carve(ctx, () => ellipsePath(ctx, cx, py, w * 0.4, 13), STONE.light, 2);
  for (const s of [-1, 1]) {
    carve(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(cx + s * w * 0.18, py - 12);
        ctx.quadraticCurveTo(cx + s * w * 0.78, py - 18, cx + s * w * 0.64, py + 10);
        ctx.quadraticCurveTo(cx + s * w * 0.44, py - 2, cx + s * w * 0.16, py - 4);
        ctx.closePath();
      },
      STONE.base,
      1.8,
    );
  }
  carve(ctx, rectPath(ctx, x0 - 10, top, w + 20, 14), STONE.light, 2.5);
  carve(ctx, rectPath(ctx, x0 - 4, top + 14, w + 8, 9), STONE.base, 1.5);
}

/** A lotus rosette in a raised square. */
function rosette(ctx: Ctx, cx: number, cy: number, r: number): void {
  carve(ctx, rectPath(ctx, cx - r, cy - r, 2 * r, 2 * r), STONE.light, 2.5);
  sunk(ctx, rectPath(ctx, cx - r * 0.84, cy - r * 0.84, r * 1.68, r * 1.68), STONE.deep, 2);
  for (let i = 0; i < 8; i++) {
    carve(
      ctx,
      () => petalPath(ctx, cx, cy, (i / 8) * TAU, r * 0.2, r * 0.62, r * 0.24),
      STONE.light,
      1.8,
    );
  }
  for (let i = 0; i < 8; i++) {
    carve(
      ctx,
      () => petalPath(ctx, cx, cy, ((i + 0.5) / 8) * TAU, r * 0.18, r * 0.4, r * 0.17),
      STONE.base,
      1.2,
    );
  }
  carve(ctx, () => circlePath(ctx, cx, cy, r * 0.2), STONE.light, 1.2);
}

/** A sunk panel with a carved diamond lattice (a blind jali). */
function lattice(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  carve(ctx, rectPath(ctx, x - 7, y - 7, w + 14, h + 14), STONE.light, 2.5);
  sunk(ctx, rectPath(ctx, x, y, w, h), STONE.deep, 3);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const step = 26;
  for (const dir of [1, -1]) {
    for (let k = -h; k < w + h; k += step) {
      carve(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(x + k - 3, y);
          ctx.lineTo(x + k + 3, y);
          ctx.lineTo(x + k + 3 + dir * h, y + h);
          ctx.lineTo(x + k - 3 + dir * h, y + h);
          ctx.closePath();
        },
        STONE.base,
        1.6,
      );
    }
  }
  // A small boss where the bars cross.
  for (let k = -h; k < w + h; k += step) {
    for (let j = 0; j * step <= h + step; j++) {
      const bx = x + k + (j * step) / 2;
      const by = y + (j * step) / 2;
      if (bx > x && bx < x + w && by > y && by < y + h)
        carve(ctx, () => circlePath(ctx, bx, by, 3.4), STONE.light, 1);
    }
  }
  ctx.restore();
}

/** Dressed stone blocks in courses of `row` px, staggered, each a little different. */
function ashlar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  row: number,
): void {
  ctx.fillStyle = STONE.joint;
  ctx.fillRect(x, y, w, h);
  const tones = [STONE.base, STONE.base, STONE.light, STONE.dark, STONE.base];
  for (let ry = y; ry < y + h; ry += row) {
    const rh = Math.min(row, y + h - ry);
    let bx = x - rnd() * 140;
    while (bx < x + w) {
      const bw = 110 + rnd() * 120;
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)] ?? STONE.base;
      ctx.fillRect(bx + 1.5, ry + 1.5, bw - 3, rh - 3);
      ctx.fillStyle = rnd() < 0.5 ? "rgba(255,236,205,0.06)" : "rgba(0,0,0,0.08)";
      ctx.fillRect(bx + 1.5, ry + 1.5, bw - 3, rh - 3);
      ctx.fillStyle = "rgba(255,238,205,0.13)";
      ctx.fillRect(bx + 1.5, ry + 1.5, bw - 3, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(bx + 1.5, ry + rh - 3.5, bw - 3, 2);
      bx += bw;
    }
  }
  grain(ctx, x, y, w, h, rnd, 0.08);
}

/** A floor slab with its own tone; `jx`/`jz` leave a joint on its centre-side edges. */
function slab(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  jx: number,
  jz: number,
): void {
  const tones = [STONE.floor, STONE.floor, STONE.floorLight, STONE.dark];
  ctx.fillStyle = tones[Math.floor(rnd() * tones.length)] ?? STONE.floor;
  ctx.fillRect(x + jx, y + jz, w - jx - 1.2, h - jz - 1.2);
  ctx.fillStyle = "rgba(255,238,210,0.07)";
  ctx.fillRect(x + jx, y + jz, w - jx - 1.2, 1.2);
}

/** Fine speckle: light and dark grains. */
function grain(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  alpha: number,
): void {
  const n = Math.round((w * h) / 70);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,240,215,${alpha})` : `rgba(15,10,6,${alpha * 1.4})`;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 1.8, 1 + rnd() * 1.8);
  }
}

/** Lamp smoke: the wall darkens towards the top. */
function soot(ctx: Ctx, w: number, h: number, reach: number, strength: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h * reach);
  g.addColorStop(0, `rgba(14,9,5,${strength})`);
  g.addColorStop(1, "rgba(14,9,5,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * reach);
}

/** Old dabs of kumkum and haldi on the stone, where the pujari touches it each day. */
function kumkum(ctx: Ctx, rnd: () => number, xs: readonly number[], y: number): void {
  for (const x of xs) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#b3261c";
    dot(ctx, x - 3 + rnd() * 2, y + rnd() * 3, 3.2 + rnd());
    ctx.fillStyle = "#d9a21f";
    dot(ctx, x + 5 + rnd() * 2, y + 1 + rnd() * 3, 2.6 + rnd());
    ctx.globalAlpha = 1;
  }
}

// --- Brushes -----------------------------------------------------------------------------------------

/** Raised carving lit from above: a shadow below right, a light edge above left, then the face. */
function carve(ctx: Ctx, path: () => void, fill: string, depth: number): void {
  ctx.save();
  ctx.translate(depth * 0.5, depth);
  path();
  ctx.fillStyle = "rgba(12,8,5,0.5)";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(-depth * 0.3, -depth * 0.5);
  path();
  ctx.fillStyle = "rgba(255,236,200,0.22)";
  ctx.fill();
  ctx.restore();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A cut-in recess: in shadow under its top edge. */
function sunk(ctx: Ctx, path: () => void, fill: string, depth: number): void {
  ctx.save();
  path();
  ctx.fillStyle = "rgba(10,7,4,0.7)";
  ctx.fill();
  path();
  ctx.clip();
  ctx.translate(depth * 0.4, depth);
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function carveStroke(ctx: Ctx, path: () => void, colour: string, width: number): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.save();
  ctx.translate(width * 0.35, width * 0.6);
  path();
  ctx.strokeStyle = "rgba(12,8,5,0.55)";
  ctx.stroke();
  ctx.restore();
  path();
  ctx.strokeStyle = colour;
  ctx.stroke();
}

const rectPath = (ctx: Ctx, x: number, y: number, w: number, h: number) => (): void => {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
};

function circlePath(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function ellipsePath(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

/** A petal from r0 out to r0 + len along angle a (0 = +x, canvas y down), wid wide. */
function petalPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  a: number,
  r0: number,
  len: number,
  wid: number,
): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const P = (u: number, v: number): [number, number] => [cx + c * u - s * v, cy + s * u + c * v];
  const [bx, by] = P(r0, 0);
  const [tx, ty] = P(r0 + len, 0);
  const [l1x, l1y] = P(r0 + len * 0.45, wid);
  const [l2x, l2y] = P(r0 + len * 0.45, -wid);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(l1x, l1y, tx, ty);
  ctx.quadraticCurveTo(l2x, l2y, bx, by);
  ctx.closePath();
}

function diamond(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.62, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.62, y);
  ctx.closePath();
  ctx.fill();
}

/** Three bel leaves from one point, in the current fill. */
function trefoil(ctx: Ctx, x: number, y: number, s: number): void {
  for (const a of [-Math.PI / 2, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15]) {
    petalPath(ctx, x, y, a, 0, a === -Math.PI / 2 ? s * 1.3 : s, s * 0.42);
    ctx.fill();
  }
}
