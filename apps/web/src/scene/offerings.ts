/**
 * The offering's things (spec 03 § Offer water, bel patra or a flower, § Receive charanamrit):
 * the leaves and flowers laid on the linga, the two offering benches with their baskets of flowers
 * and bel patra and a lota of water, the small copper tirtha pots with their spoons on their stone
 * stands (one each side), and the water seen running out along the somasutra channel after
 * someone pours.
 *
 * Each client draws the offerings on the linga from the events it receives, so a newcomer sees
 * none. At most OFFERING_MAX items; each one goes after OFFERING_FADE_S. A few draw calls in all:
 * the leaflets, petals and flower centres are instanced.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  Euler,
  Float32BufferAttribute,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  OFFERING_BENCHES,
  OFFERING_BENCH_HALF_DEPTH,
  OFFERING_BENCH_HALF_LENGTH,
  OFFERING_BENCH_TOP,
  LINGA,
  SOMASUTRA,
  TIRTHA_POTS,
} from "@sannidhi/protocol";
import { PLINTH } from "./ground";

/** Leaves and flowers shown on the linga at once. */
export const OFFERING_MAX = 12;
/** Each one goes after 10 minutes (spec 03). */
export const OFFERING_FADE_S = 600;
/** How long the water runs along the channel after a pour. */
export const OUTFLOW_S = 6;
/** How far down the channel the water is seen, in metres. */
const OUTFLOW_LENGTH = 5;

/** The top of the small stone stand the tirtha pot rests on, on the mandapa floor. */
const STAND_TOP = PLINTH + 0.32;
/**
 * Where offerings rest on the linga slot's model (assets-src/models/linga, origin at its bottom
 * on the sanctum floor): the top of the shaft, and the pitha's basin between the shaft and the
 * rim. The spout points north (+x), so nothing is laid in the groove.
 */
const LINGA_FLOOR = PLINTH + 0.015;
const LINGA_TOP = { y: LINGA_FLOOR + 0.915, r: 0.05 } as const;
const BASIN = { y: LINGA_FLOOR + 0.372, r0: 0.21, r1: 0.35 } as const;
/** The channel's groove (greybox.ts): from the catch stone northwards, floor at 0.03 m. */
const GROOVE = { x0: 3.45, y: 0.045, halfWidth: 0.11 } as const;

export type LaidItem = "bilva" | "flower";

interface Laid {
  kind: LaidItem;
  /** Where it rests, in world space. */
  x: number;
  y: number;
  z: number;
  turn: number;
  age: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const v = new Vector3();
const one = new Vector3(1, 1, 1);
const scale = new Vector3();

export class Offerings {
  readonly group = new Group();
  private readonly laid: Laid[] = [];
  private readonly pending: { at: number; run: () => void }[] = [];
  private time = 0;
  private slot = 0;
  private readonly leaflets: InstancedMesh;
  private readonly petals: InstancedMesh;
  private readonly centres: InstancedMesh;
  private readonly flow: Mesh;
  private readonly flowMaterial: MeshBasicMaterial;
  /** Seconds since the last pour reached the channel, or null when dry. */
  private flowT: number | null = null;
  private readonly owned: (BufferGeometry | Material)[] = [];

  constructor() {
    // Everything that never moves (the benches with their baskets and lotas, the tirtha pots
    // on their stands) is merged into one mesh with vertex colours: one draw call (spec 10).
    const still: [Mesh, string][] = [];
    const put = (geo: BufferGeometry, color: string, x: number, y: number, z: number): Mesh => {
      const m = new Mesh(geo);
      m.position.set(x, y, z);
      still.push([m, color]);
      return m;
    };
    const COPPER = "#b4643c";
    const STONE = "#6f685c";
    const BENCH_STONE = "#8a8174";
    const CANE = "#a27a45";
    const MARIGOLD = "#e89a1c";
    // White flowers (jasmine-like), never champa (spec 08, check with advisor).
    const WHITE = "#f4f1e6";
    const BEL = "#4f7a32";

    // The offering benches: a low stone bench each side, with a basket of flowers, a basket of
    // bel patra and a copper lota of water on it.
    const topGeo = this.own(
      new BoxGeometry(OFFERING_BENCH_HALF_LENGTH * 2, 0.06, OFFERING_BENCH_HALF_DEPTH * 2),
    );
    const legGeo = this.own(
      new BoxGeometry(0.12, OFFERING_BENCH_TOP - 0.06, OFFERING_BENCH_HALF_DEPTH * 2 - 0.06),
    );
    const basketGeo = this.own(new CylinderGeometry(0.11, 0.08, 0.07, 14, 1, true));
    const basketBaseGeo = this.own(new CircleGeometry(0.08, 14));
    const heapGeo = this.own(new SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const blossomGeo = this.own(new SphereGeometry(0.022, 6, 4));
    const lotaGeo = this.own(
      new LatheGeometry(
        [
          [0, 0],
          [0.045, 0.004],
          [0.075, 0.045],
          [0.07, 0.09],
          [0.035, 0.12],
          [0.03, 0.14],
          [0.045, 0.155],
        ].map(([x, y]) => new Vector2(x, y)),
        16,
      ),
    );
    const top = PLINTH + OFFERING_BENCH_TOP;
    for (const b of OFFERING_BENCHES) {
      // The inner end (nearer the door) holds the lota, so it is the first thing reached.
      const inward = b.x > 0 ? -1 : 1;
      put(topGeo, BENCH_STONE, b.x, top - 0.03, b.z);
      for (const dx of [-1, 1]) {
        put(
          legGeo,
          BENCH_STONE,
          b.x + dx * (OFFERING_BENCH_HALF_LENGTH - 0.1),
          PLINTH + (OFFERING_BENCH_TOP - 0.06) / 2,
          b.z,
        );
      }
      put(lotaGeo, COPPER, b.x + inward * 0.3, top, b.z);
      // Bel patra in the middle basket, white flowers with a few marigolds in the outer one.
      for (const [dx, fill] of [
        [0, BEL],
        [-inward * 0.28, WHITE],
      ] as const) {
        const x = b.x + dx;
        put(basketGeo, CANE, x, top + 0.035, b.z);
        put(basketBaseGeo, CANE, x, top + 0.002, b.z).rotation.x = -Math.PI / 2;
        put(heapGeo, fill, x, top + 0.05, b.z).scale.set(0.95, 0.45, 0.95);
        if (fill === WHITE) {
          for (let k = 0; k < 5; k++) {
            const a = k * 1.3;
            const c = k % 2 === 0 ? WHITE : MARIGOLD;
            put(blossomGeo, c, x + Math.cos(a) * 0.05, top + 0.085, b.z + Math.sin(a) * 0.05);
          }
        }
      }
    }

    // A tirtha pot with its spoon on a small stone stand, one each side.
    const standGeo = this.own(new CylinderGeometry(0.11, 0.13, STAND_TOP - PLINTH, 10));
    const potGeo = this.own(
      new LatheGeometry(
        [
          [0, 0],
          [0.05, 0.005],
          [0.075, 0.04],
          [0.07, 0.075],
          [0.05, 0.095],
          [0.055, 0.105],
        ].map(([x, y]) => new Vector2(x, y)),
        14,
      ),
    );
    const spoonGeo = this.own(new CylinderGeometry(0.004, 0.004, 0.16, 5));
    for (const t of TIRTHA_POTS) {
      put(standGeo, STONE, t.x, (PLINTH + STAND_TOP) / 2, t.z);
      put(potGeo, COPPER, t.x, STAND_TOP, t.z);
      put(spoonGeo, COPPER, t.x, STAND_TOP + 0.12, t.z + 0.02).rotation.x = 0.35;
    }

    // Leaves and flowers on the linga, instanced.
    const leaflet = this.own(new CircleGeometry(0.045, 8));
    const petal = this.own(new CircleGeometry(0.02, 8));
    const centre = this.own(new CircleGeometry(0.013, 8));
    const leafMat = this.own(new MeshLambertMaterial({ color: "#4f7a32", side: DoubleSide }));
    const whiteMat = this.own(new MeshLambertMaterial({ color: "#f4f1e6", side: DoubleSide }));
    // A pale bud at the centre, no yellow, so it reads as a jasmine-like white flower, not champa.
    const budMat = this.own(new MeshLambertMaterial({ color: "#ece4cc", side: DoubleSide }));
    this.leaflets = new InstancedMesh(leaflet, leafMat, OFFERING_MAX * 6);
    this.petals = new InstancedMesh(petal, whiteMat, OFFERING_MAX * 10);
    this.centres = new InstancedMesh(centre, budMat, OFFERING_MAX * 2);
    for (const im of [this.leaflets, this.petals, this.centres]) {
      im.count = 0;
      // Everything on them rests on the linga: cull with a sphere round it.
      im.boundingSphere = new Sphere(new Vector3(LINGA.x, LINGA_FLOOR + 0.5, LINGA.z), 0.75);
    }

    // Water along the channel's groove, shown for a few seconds after a pour.
    this.flowMaterial = this.own(
      new MeshBasicMaterial({ color: "#bcd8e6", transparent: true, opacity: 0, depthWrite: false }),
    );
    this.flow = new Mesh(this.own(new PlaneGeometry(1, GROOVE.halfWidth * 2)), this.flowMaterial);
    this.flow.rotation.x = -Math.PI / 2;
    this.flow.position.set(GROOVE.x0, GROOVE.y, SOMASUTRA.z);
    this.flow.visible = false;

    this.group.add(this.mergeColoured(still), this.leaflets, this.petals, this.centres, this.flow);
  }

  /** A leaf or flower laid on the linga `delayS` from now (when the hands reach it). */
  lay(kind: LaidItem, delayS = 0): void {
    this.later(delayS, () => {
      const i = this.slot++;
      // Every fourth rests on top of the linga; the rest go round the basin, away from the spout
      // (north, +x), in a loose spiral so recent offerings don't hide each other.
      let x: number;
      let y: number;
      let z: number;
      const turn = i * 4.1;
      if (i % 4 === 0) {
        const a = i * 2.4;
        const r = LINGA_TOP.r * ((i * 0.37) % 1);
        x = LINGA.x + Math.cos(a) * r;
        y = LINGA_TOP.y;
        z = LINGA.z + Math.sin(a) * r;
      } else {
        // Angles from +x: the spout is at 0, so keep within 0.8 … 2π − 0.8.
        const a = 0.8 + ((i * 0.618) % 1) * (Math.PI * 2 - 1.6);
        const r = BASIN.r0 + (BASIN.r1 - BASIN.r0) * ((i * 0.37) % 1);
        x = LINGA.x + Math.cos(a) * r;
        y = BASIN.y;
        z = LINGA.z + Math.sin(a) * r;
      }
      this.laid.push({ kind, x, y, z, turn, age: 0 });
      if (this.laid.length > OFFERING_MAX) this.laid.shift();
      this.rebuild();
    });
  }

  /** Water runs out along the channel `delayS` from now (as the pour reaches the linga). */
  pour(delayS = 0): void {
    this.later(delayS, () => {
      this.flowT = 0;
    });
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p && this.time >= p.at) {
        this.pending.splice(i, 1);
        p.run();
      }
    }
    let gone = false;
    for (const l of this.laid) l.age += dt;
    while (this.laid[0] && this.laid[0].age > OFFERING_FADE_S) {
      this.laid.shift();
      gone = true;
    }
    if (gone) this.rebuild();

    if (this.flowT === null) return;
    this.flowT += dt;
    const t = this.flowT;
    if (t >= OUTFLOW_S) {
      this.flowT = null;
      this.flow.visible = false;
      return;
    }
    // The water's front runs down the channel, then the trickle thins away.
    const reach = Math.min(1, t / 2) * OUTFLOW_LENGTH;
    this.flow.visible = true;
    this.flow.scale.set(Math.max(0.01, reach), 1, 1);
    this.flow.position.x = GROOVE.x0 + reach / 2;
    this.flowMaterial.opacity = 0.6 * Math.min(1, (OUTFLOW_S - t) / 2.5);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
    for (const im of [this.leaflets, this.petals, this.centres]) im.dispose();
  }

  private later(delayS: number, run: () => void): void {
    if (delayS <= 0) run();
    else this.pending.push({ at: this.time + delayS, run });
  }

  /** One mesh for all the still things, each painted its colour: one draw call. */
  private mergeColoured(parts: readonly [Mesh, string][]): Mesh {
    const c = new Color();
    const geos = parts.map(([m, color]) => {
      m.updateMatrix();
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      c.set(color);
      const n = g.getAttribute("position").count;
      const rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) throw new Error("offerings: could not merge the still parts");
    return new Mesh(this.own(merged), this.own(new MeshLambertMaterial({ vertexColors: true })));
  }

  private own<T extends BufferGeometry | Material>(o: T): T {
    this.owned.push(o);
    return o;
  }

  private rebuild(): void {
    let nl = 0;
    let np = 0;
    let nc = 0;
    for (const l of this.laid) {
      const cx = l.x;
      const cz = l.z;
      const y = l.y;
      if (l.kind === "bilva") {
        // Three leaflets from one point, the middle one longest.
        for (const [angle, len] of [
          [0, 1.25],
          [1.0, 1],
          [-1.0, 1],
        ] as const) {
          const a = l.turn + angle;
          v.set(cx + Math.sin(a) * 0.03 * len, y + nl * 0.0004, cz + Math.cos(a) * 0.03 * len);
          q.setFromEuler(e.set(-Math.PI / 2, 0, -a));
          scale.set(0.55, len, 1);
          this.leaflets.setMatrixAt(nl++, m4.compose(v, q, scale));
        }
      } else {
        for (let k = 0; k < 5; k++) {
          const a = l.turn + (k / 5) * Math.PI * 2;
          v.set(cx + Math.cos(a) * 0.022, y + 0.002, cz + Math.sin(a) * 0.022);
          q.setFromEuler(e.set(-Math.PI / 2, 0, 0));
          this.petals.setMatrixAt(np++, m4.compose(v, q, one));
        }
        v.set(cx, y + 0.004, cz);
        this.centres.setMatrixAt(nc++, m4.compose(v, q, one));
      }
    }
    this.leaflets.count = nl;
    this.petals.count = np;
    this.centres.count = nc;
    for (const im of [this.leaflets, this.petals, this.centres])
      im.instanceMatrix.needsUpdate = true;
  }
}
