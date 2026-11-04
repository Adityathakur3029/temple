/**
 * Tap-to-walk navigation (spec 02 § Controls): a 0.25 m grid built from world.ts, A* across it,
 * then string-pulling so the visitor walks in straight lines between turns.
 *
 * Grid cells are open only if a disc of NAV_CLEARANCE around their centre is walkable, so every
 * point of an open cell keeps the 0.25 m body radius clear of obstacles and sacred zones.
 */
import {
  BODY_RADIUS,
  PRADAKSHINA_MODE,
  WALKABLE,
  isWalkable,
  type Point,
  type PradakshinaMode,
  type Shape,
} from "@sannidhi/protocol";

/** The avatar's body radius for collision (spec 02 § Greybox details), shared with the server. */
export { BODY_RADIUS };
export const CELL = 0.25;
/** Body radius plus half a cell diagonal. */
export const NAV_CLEARANCE = BODY_RADIUS + (CELL * Math.SQRT2) / 2;

const RIM = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return { x: Math.sin(a), z: Math.cos(a) };
});

/** True if a disc of radius `r` at (x, z) is walkable (centre and 8 rim points). */
export function isClear(
  x: number,
  z: number,
  r = BODY_RADIUS,
  mode: PradakshinaMode = PRADAKSHINA_MODE,
): boolean {
  if (!isWalkable(x, z, mode)) return false;
  for (const d of RIM) if (!isWalkable(x + d.x * r, z + d.z * r, mode)) return false;
  return true;
}

function bounds(shapes: readonly Shape[]): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const s of shapes) {
    const b =
      s.kind === "rect"
        ? s
        : s.kind === "circle"
          ? { x0: s.x - s.r, x1: s.x + s.r, z0: s.z - s.r, z1: s.z + s.r }
          : {
              x0: Math.min(s.ax, s.bx) - s.r,
              x1: Math.max(s.ax, s.bx) + s.r,
              z0: Math.min(s.az, s.bz) - s.r,
              z1: Math.max(s.az, s.bz) + s.r,
            };
    x0 = Math.min(x0, b.x0);
    x1 = Math.max(x1, b.x1);
    z0 = Math.min(z0, b.z0);
    z1 = Math.max(z1, b.z1);
  }
  return { x0, x1, z0, z1 };
}

const SQRT2 = Math.SQRT2;
const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
] as const;

/** Binary min-heap of cell indices keyed by f-score. */
class Heap {
  private items = new Int32Array(1024);
  private keys = new Float64Array(1024);
  size = 0;

  push(item: number, key: number): void {
    if (this.size === this.items.length) {
      const items = new Int32Array(this.size * 2);
      items.set(this.items);
      this.items = items;
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] ?? 0) <= key) break;
      this.items[i] = this.items[p] ?? 0;
      this.keys[i] = this.keys[p] ?? 0;
      i = p;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    const item = this.items[--this.size] ?? 0;
    const key = this.keys[this.size] ?? 0;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && (this.keys[c + 1] ?? 0) < (this.keys[c] ?? 0)) c++;
      if ((this.keys[c] ?? 0) >= key) break;
      this.items[i] = this.items[c] ?? 0;
      this.keys[i] = this.keys[c] ?? 0;
      i = c;
    }
    this.items[i] = item;
    this.keys[i] = key;
    return top;
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly z0: number;
  /** 1 where a visitor's body fits. */
  readonly open: Uint8Array;
  private readonly g: Float32Array;
  private readonly from: Int32Array;
  private readonly seen: Uint32Array;
  private generation = 0;

  /** Rows filled so far; the grid is usable once every row is. */
  private builtRows = 0;

  /**
   * With `deferred`, the grid starts empty and is filled by buildSome() in small slices (so the
   * main thread never freezes); any query finishes it first. Otherwise it is built at once.
   */
  constructor(
    readonly mode: PradakshinaMode = PRADAKSHINA_MODE,
    opts: { deferred?: boolean } = {},
  ) {
    const b = bounds(WALKABLE);
    this.x0 = b.x0;
    this.z0 = b.z0;
    this.cols = Math.ceil((b.x1 - b.x0) / CELL);
    this.rows = Math.ceil((b.z1 - b.z0) / CELL);
    const n = this.cols * this.rows;
    this.open = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    if (!opts.deferred) this.buildSome(Infinity);
  }

  get ready(): boolean {
    return this.builtRows >= this.rows;
  }

  /** Fills rows for up to `budgetMs`. Returns true once the whole grid is built. */
  buildSome(budgetMs: number): boolean {
    const until = performance.now() + budgetMs;
    while (this.builtRows < this.rows) {
      const r = this.builtRows++;
      const z = this.z0 + (r + 0.5) * CELL;
      for (let c = 0; c < this.cols; c++) {
        if (isClear(this.x0 + (c + 0.5) * CELL, z, NAV_CLEARANCE, this.mode)) {
          this.open[r * this.cols + c] = 1;
        }
      }
      if (performance.now() >= until) break;
    }
    return this.ready;
  }

  /** Cell index at a point, or −1 outside the grid. */
  cellAt(x: number, z: number): number {
    const c = Math.floor((x - this.x0) / CELL);
    const r = Math.floor((z - this.z0) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  centre(i: number): Point {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    return { x: this.x0 + (c + 0.5) * CELL, z: this.z0 + (r + 0.5) * CELL };
  }

  isOpen(i: number): boolean {
    return i >= 0 && this.open[i] === 1;
  }

  /** The open cell nearest to a point, searching outwards up to `maxM` metres. */
  nearestOpen(x: number, z: number, maxM = 12): number {
    const here = this.cellAt(x, z);
    if (this.isOpen(here)) return here;
    const c0 = Math.floor((x - this.x0) / CELL);
    const r0 = Math.floor((z - this.z0) / CELL);
    let best = -1;
    let bestD = Infinity;
    const maxRing = Math.ceil(maxM / CELL);
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (!this.isOpen(i)) continue;
          const p = this.centre(i);
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      // Anything in a later ring is at least `ring` cells away.
      if (best >= 0 && Math.sqrt(bestD) <= ring * CELL) break;
    }
    return best;
  }

  /** True if every point of the segment (sampled every half cell) lies in an open cell. */
  lineOpen(a: Point, b: Point): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isOpen(this.cellAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))) return false;
    }
    return true;
  }

  /**
   * Waypoints from `start` towards `goal`, excluding the start. If the goal can't be stood on,
   * the path ends at the nearest place that can. Null if nothing reachable is near the goal.
   */
  findPath(start: Point, goal: Point): Point[] | null {
    this.buildSome(Infinity);
    const s = this.nearestOpen(start.x, start.z, 3);
    const gCell = this.nearestOpen(goal.x, goal.z);
    if (s < 0 || gCell < 0) return null;
    const end = this.cellAt(goal.x, goal.z) === gCell ? goal : this.centre(gCell);

    const cells = this.search(s, gCell);
    if (!cells) return null;
    const raw = cells.map((i) => this.centre(i));
    raw[raw.length - 1] = end;

    // String-pulling: from each anchor, go straight to the furthest waypoint in sight.
    const out: Point[] = [];
    let anchor: Point = this.isOpen(this.cellAt(start.x, start.z)) ? start : (raw[0] ?? start);
    if (anchor !== start) out.push(anchor);
    let i = 0;
    while (i < raw.length) {
      let j = i;
      while (j + 1 < raw.length && this.lineOpen(anchor, raw[j + 1] ?? anchor)) j++;
      const next = raw[j] ?? anchor;
      if (next !== anchor) out.push(next);
      anchor = next;
      i = j + 1;
    }
    return out;
  }

  private search(start: number, goal: number): number[] | null {
    const gen = ++this.generation;
    const goalP = this.centre(goal);
    const h = (i: number): number => {
      const p = this.centre(i);
      const dx = Math.abs(p.x - goalP.x) / CELL;
      const dz = Math.abs(p.z - goalP.z) / CELL;
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    const heap = new Heap();
    this.seen[start] = gen;
    this.g[start] = 0;
    this.from[start] = -1;
    heap.push(start, h(start));
    // `seen` marks discovered cells; a closed cell is stored as generation + 2^31.
    const closedMark = (gen | 0x80000000) >>> 0;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.seen[cur] === closedMark) continue;
      this.seen[cur] = closedMark;
      if (cur === goal) {
        const path: number[] = [];
        for (let i = cur; i !== -1; i = this.from[i] ?? -1) path.push(i);
        return path.reverse();
      }
      const c = cur % this.cols;
      const r = Math.floor(cur / this.cols);
      for (const [dc, dr, cost] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (this.open[ni] !== 1 || this.seen[ni] === closedMark) continue;
        // No cutting corners past a blocked cell.
        if (
          dc !== 0 &&
          dr !== 0 &&
          (this.open[r * this.cols + nc] !== 1 || this.open[nr * this.cols + c] !== 1)
        ) {
          continue;
        }
        const g = (this.g[cur] ?? 0) + cost;
        if (this.seen[ni] !== gen || g < (this.g[ni] ?? Infinity)) {
          this.seen[ni] = gen;
          this.g[ni] = g;
          this.from[ni] = cur;
          heap.push(ni, g + h(ni));
        }
      }
    }
    return null;
  }
}
