/**
 * The jal spots' things (spec 03 § Offer water, bel patra or a flower, § Receive charanamrit):
 * the brass offering plates each side of the door with the leaves and flowers laid on them, the
 * two offering benches with their baskets of flowers and bel patra and a lota of water, the small
 * copper tirtha pot with its spoon on its stone stand, and the water seen running out along the
 * somasutra channel after someone pours.
 *
 * Each client draws the plate from the events it receives, so a newcomer sees it empty. At most
 * OFFERING_PLATE_MAX items; each one goes after OFFERING_FADE_S. A few draw calls in all: the
 * leaflets, petals and flower centres are instanced.
 */
import {
  BoxGeometry,
  CircleGeometry,
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
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  OFFERING_BENCHES,
  OFFERING_BENCH_HALF_DEPTH,
  OFFERING_BENCH_HALF_LENGTH,
  OFFERING_BENCH_TOP,
  OFFERING_PLATES,
  OFFERING_PLATE_RADIUS,
  SOMASUTRA,
  TIRTHA_POT,
} from "@sannidhi/protocol";
import { PLINTH } from "./ground";

/** Leaves and flowers shown on the plate at once. */
export const OFFERING_PLATE_MAX = 12;
/** Each one goes after 10 minutes (spec 03). */
export const OFFERING_FADE_S = 600;
/** How long the water runs along the channel after a pour. */
export const OUTFLOW_S = 6;
/** How far down the channel the water is seen, in metres. */
const OUTFLOW_LENGTH = 5;

/** The top of the small stone stand the tirtha pot rests on, on the mandapa floor. */
const STAND_TOP = PLINTH + 0.32;
/** The channel's groove (greybox.ts): from the catch stone northwards, floor at 0.03 m. */
const GROOVE = { x0: 3.45, y: 0.045, halfWidth: 0.11 } as const;

export type PlateItem = "bilva" | "flower";

interface Laid {
  kind: PlateItem;
  /** Which plate (0 north, 1 south). */
  side: number;
  /** Position on the plate, relative to its centre. */
  x: number;
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
  private readonly slot = [0, 0];
  private readonly leaflets: InstancedMesh;
  private readonly petals: InstancedMesh;
  private readonly centres: InstancedMesh;
  private readonly flow: Mesh;
  private readonly flowMaterial: MeshBasicMaterial;
  /** Seconds since the last pour reached the channel, or null when dry. */
  private flowT: number | null = null;
  private readonly owned: (BufferGeometry | Material)[] = [];

  constructor() {
    const brass = this.own(new MeshLambertMaterial({ color: "#b08a3a" }));
    const copper = this.own(new MeshLambertMaterial({ color: "#b4643c" }));
    const stone = this.own(new MeshLambertMaterial({ color: "#6f685c" }));

    // The plates: a shallow brass dish on the mandapa floor each side of the door.
    const plateGeo = this.own(
      new CylinderGeometry(OFFERING_PLATE_RADIUS, OFFERING_PLATE_RADIUS * 0.85, 0.02, 20),
    );
    const rimGeo = this.own(
      new CylinderGeometry(OFFERING_PLATE_RADIUS, OFFERING_PLATE_RADIUS, 0.012, 20, 1, true),
    );
    const plates: Mesh[] = [];
    for (const p of OFFERING_PLATES) {
      const plate = new Mesh(plateGeo, brass);
      plate.position.set(p.x, PLINTH + 0.01, p.z);
      const rim = new Mesh(rimGeo, brass);
      rim.position.set(p.x, PLINTH + 0.026, p.z);
      plates.push(plate, rim);
    }

    // The offering benches: a low stone bench each side, with a basket of flowers, a basket of
    // bel patra and a copper lota of water on it.
    const benchStone = this.own(new MeshLambertMaterial({ color: "#8a8174" }));
    const cane = this.own(new MeshLambertMaterial({ color: "#a27a45" }));
    const marigold = this.own(new MeshLambertMaterial({ color: "#e89a1c" }));
    const champa = this.own(new MeshLambertMaterial({ color: "#f3ecd6" }));
    const bel = this.own(new MeshLambertMaterial({ color: "#4f7a32" }));
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
    const benches: Mesh[] = [];
    const top = PLINTH + OFFERING_BENCH_TOP;
    for (const b of OFFERING_BENCHES) {
      // The inner end (nearer the door) holds the lota, so it is the first thing reached.
      const inward = b.x > 0 ? -1 : 1;
      const slab = new Mesh(topGeo, benchStone);
      slab.position.set(b.x, top - 0.03, b.z);
      benches.push(slab);
      for (const dx of [-1, 1]) {
        const leg = new Mesh(legGeo, benchStone);
        leg.position.set(
          b.x + dx * (OFFERING_BENCH_HALF_LENGTH - 0.1),
          PLINTH + (OFFERING_BENCH_TOP - 0.06) / 2,
          b.z,
        );
        benches.push(leg);
      }
      const lota = new Mesh(lotaGeo, copper);
      lota.position.set(b.x + inward * 0.3, top, b.z);
      benches.push(lota);
      // Bel patra in the middle basket, flowers (marigold and champa) in the outer one.
      for (const [dx, fill] of [
        [0, bel],
        [-inward * 0.28, marigold],
      ] as const) {
        const x = b.x + dx;
        const basket = new Mesh(basketGeo, cane);
        basket.position.set(x, top + 0.035, b.z);
        const base = new Mesh(basketBaseGeo, cane);
        base.rotation.x = -Math.PI / 2;
        base.position.set(x, top + 0.002, b.z);
        const heap = new Mesh(heapGeo, fill);
        heap.scale.set(0.95, 0.45, 0.95);
        heap.position.set(x, top + 0.05, b.z);
        benches.push(basket, base, heap);
        if (fill === marigold) {
          for (let k = 0; k < 5; k++) {
            const a = k * 1.3;
            const blossom = new Mesh(blossomGeo, k % 2 === 0 ? champa : marigold);
            blossom.position.set(x + Math.cos(a) * 0.05, top + 0.085, b.z + Math.sin(a) * 0.05);
            benches.push(blossom);
          }
        }
      }
    }

    // The tirtha pot with its spoon, on a small stone stand.
    const standGeo = this.own(new CylinderGeometry(0.11, 0.13, STAND_TOP - PLINTH, 10));
    const stand = new Mesh(standGeo, stone);
    stand.position.set(TIRTHA_POT.x, (PLINTH + STAND_TOP) / 2, TIRTHA_POT.z);
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
    const pot = new Mesh(potGeo, copper);
    pot.position.set(TIRTHA_POT.x, STAND_TOP, TIRTHA_POT.z);
    const spoon = new Mesh(this.own(new CylinderGeometry(0.004, 0.004, 0.16, 5)), copper);
    spoon.position.set(TIRTHA_POT.x, STAND_TOP + 0.12, TIRTHA_POT.z + 0.02);
    spoon.rotation.x = 0.35;

    // Leaves and flowers on the plate, instanced.
    const leaflet = this.own(new CircleGeometry(0.045, 8));
    const petal = this.own(new CircleGeometry(0.022, 6));
    const centre = this.own(new CircleGeometry(0.012, 6));
    const leafMat = this.own(new MeshLambertMaterial({ color: "#4f7a32", side: DoubleSide }));
    const whiteMat = this.own(new MeshLambertMaterial({ color: "#f4f1e6", side: DoubleSide }));
    const yellowMat = this.own(new MeshLambertMaterial({ color: "#d9a520", side: DoubleSide }));
    this.leaflets = new InstancedMesh(leaflet, leafMat, OFFERING_PLATE_MAX * 6);
    this.petals = new InstancedMesh(petal, whiteMat, OFFERING_PLATE_MAX * 10);
    this.centres = new InstancedMesh(centre, yellowMat, OFFERING_PLATE_MAX * 2);
    for (const im of [this.leaflets, this.petals, this.centres]) {
      im.count = 0;
      // Everything on them lies on the plates: cull with a sphere round both.
      const [n, so] = OFFERING_PLATES;
      im.boundingSphere = new Sphere(
        new Vector3(((n?.x ?? 0) + (so?.x ?? 0)) / 2, PLINTH, n?.z ?? 0),
        Math.abs((n?.x ?? 0) - (so?.x ?? 0)) / 2 + OFFERING_PLATE_RADIUS + 0.1,
      );
    }

    // Water along the channel's groove, shown for a few seconds after a pour.
    this.flowMaterial = this.own(
      new MeshBasicMaterial({ color: "#bcd8e6", transparent: true, opacity: 0, depthWrite: false }),
    );
    this.flow = new Mesh(this.own(new PlaneGeometry(1, GROOVE.halfWidth * 2)), this.flowMaterial);
    this.flow.rotation.x = -Math.PI / 2;
    this.flow.position.set(GROOVE.x0, GROOVE.y, SOMASUTRA.z);
    this.flow.visible = false;

    this.group.add(
      ...plates,
      ...this.mergeByMaterial(benches),
      stand,
      pot,
      spoon,
      this.leaflets,
      this.petals,
      this.centres,
      this.flow,
    );
  }

  /** A leaf or flower laid on a plate (0 north, 1 south) `delayS` from now (when the hands reach it). */
  lay(kind: PlateItem, delayS = 0, side = 0): void {
    this.later(delayS, () => {
      // Spread round the plate in a loose spiral, so recent offerings don't hide each other.
      const i = this.slot[side] ?? 0;
      this.slot[side] = i + 1;
      const r = OFFERING_PLATE_RADIUS * (0.25 + 0.5 * ((i * 0.37) % 1));
      const a = i * 2.4;
      this.laid.push({ kind, side, x: Math.cos(a) * r, z: Math.sin(a) * r, turn: a * 1.7, age: 0 });
      if (this.laid.length > OFFERING_PLATE_MAX * 2) this.laid.shift();
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

  /** One mesh per material for the benches and what lies on them: a few draw calls in all. */
  private mergeByMaterial(parts: readonly Mesh[]): Mesh[] {
    const byMat = new Map<Material, BufferGeometry[]>();
    for (const m of parts) {
      m.updateMatrix();
      const g = m.geometry.clone().applyMatrix4(m.matrix);
      const mat = m.material as Material;
      byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
    }
    const out: Mesh[] = [];
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) out.push(new Mesh(this.own(merged), mat));
    }
    return out;
  }

  private own<T extends BufferGeometry | Material>(o: T): T {
    this.owned.push(o);
    return o;
  }

  private rebuild(): void {
    let nl = 0;
    let np = 0;
    let nc = 0;
    const y = PLINTH + 0.024;
    for (const l of this.laid) {
      const plate = OFFERING_PLATES[l.side] ?? OFFERING_PLATES[0];
      const cx = (plate?.x ?? 0) + l.x;
      const cz = (plate?.z ?? 0) + l.z;
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
