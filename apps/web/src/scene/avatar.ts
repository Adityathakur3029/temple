/**
 * Placeholder devotee avatar (spec 02 § Avatar): about 1.6 m, simple rounded forms, kurta with a
 * dhoti or salwar, a wool shawl in one of 8 colours, and barefoot. No face, tilak or other marker.
 * Animations are procedural for M1: idle, walk and sit (sukhasana, cross-legged, facing the
 * sanctum). The rig has no running, jumping, dancing or emote motion at all.
 * M5 replaces this with the skinned asset and vertex animation textures (spec 11).
 */
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";

/** Muted wool shawl colours; the server assigns an index 0–7 (spec 04 `Visitor.shawl`). */
export const SHAWL_COLOURS = [
  "#7a2e2e", // madder red
  "#8f5632", // rust
  "#a88436", // mustard
  "#5f6436", // olive
  "#2f5d5a", // teal
  "#36426b", // indigo
  "#5a3a5a", // plum
  "#4a4a4a", // charcoal
] as const;

const SKIN = "#9a6b4f";
const HAIR = "#2a221d";
const KURTA = "#e6dfce";

/** Stride: metres walked per full walk cycle (two steps), for a calm 1.3 m/s pace. */
const CYCLE_M = 1.45;
/** Sitting down or standing up takes this long. */
const SIT_S = 0.9;

interface Body {
  scale: number;
  shoulder: number;
  hip: number;
  lower: string;
  /** Lower-leg radius at the ankle: wide for a dhoti, narrow for a salwar. */
  ankle: number;
}

const BODIES: readonly Body[] = [
  { scale: 1, shoulder: 0.19, hip: 0.09, lower: "#efe9d8", ankle: 0.075 },
  { scale: 0.96, shoulder: 0.17, hip: 0.095, lower: "#e2d8c3", ankle: 0.05 },
];

const ease = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Avatar {
  readonly root = new Group();
  private readonly hips = new Group();
  private readonly spine = new Group();
  private readonly head = new Group();
  private readonly skirt: Mesh;
  private readonly arm: [Group, Group, Group, Group]; // upperL, foreL, upperR, foreR
  private readonly leg: [Group, Group, Group, Group]; // thighL, shinL, thighR, shinR
  private readonly feet: [Mesh, Mesh];
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly hipHeight: number;

  /** 0 standing … 1 seated. */
  sitBlend = 0;
  private sitTarget = 0;
  private walkAmount = 0;
  private time = 0;

  constructor(opts: { shawl: number; body: 0 | 1 }) {
    const body = BODIES[opts.body] ?? BODIES[0];
    if (!body) throw new Error("no avatar body");
    const mat = (color: string): MeshLambertMaterial => {
      const m = new MeshLambertMaterial({ color });
      this.materials.push(m);
      return m;
    };
    const skin = mat(SKIN);
    const cloth = mat(KURTA);
    const lower = mat(body.lower);
    const shawl = mat(SHAWL_COLOURS[opts.shawl % SHAWL_COLOURS.length] ?? SHAWL_COLOURS[0]);
    const hair = mat(HAIR);
    const geo = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const part = (
      g: BufferGeometry,
      m: Material,
      y = 0,
      parent: Group = this.root,
      x = 0,
      z = 0,
    ): Mesh => {
      const mesh = new Mesh(geo(g), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    const thigh = 0.42;
    const shin = 0.4;
    this.hipHeight = thigh + shin + 0.07;
    this.root.add(this.hips);
    this.hips.position.y = this.hipHeight;

    // Torso, kurta hem and shawl.
    this.hips.add(this.spine);
    part(new CylinderGeometry(body.shoulder - 0.02, 0.16, 0.5, 12), cloth, 0.25, this.spine);
    this.skirt = part(new CylinderGeometry(0.165, 0.19, 0.3, 12), cloth, -0.13, this.hips);
    part(
      new CylinderGeometry(body.shoulder + 0.01, body.shoulder - 0.005, 0.3, 12),
      shawl,
      0.36,
      this.spine,
    );
    part(
      new SphereGeometry(body.shoulder + 0.012, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      shawl,
      0.5,
      this.spine,
    );

    // Neck and head: no face, no markers.
    this.spine.add(this.head);
    this.head.position.y = 0.52;
    part(new CylinderGeometry(0.045, 0.05, 0.08, 8), skin, 0.03, this.head);
    part(new SphereGeometry(0.105, 16, 12), skin, 0.15, this.head);
    const cap = part(
      new SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      hair,
      0.16,
      this.head,
    );
    cap.rotation.x = -0.25;
    if (opts.body === 1) part(new SphereGeometry(0.055, 10, 8), hair, 0.17, this.head, 0, -0.1);

    // Arms hang from the shoulders, sleeves in the kurta cloth and hands in skin.
    const makeArm = (side: 1 | -1): [Group, Group] => {
      const upper = new Group();
      upper.position.set(side * (body.shoulder + 0.02), 0.47, 0);
      this.spine.add(upper);
      part(new SphereGeometry(0.06, 8, 6), shawl, 0, upper);
      part(new CylinderGeometry(0.05, 0.045, 0.28, 8), cloth, -0.14, upper);
      const fore = new Group();
      fore.position.y = -0.28;
      upper.add(fore);
      part(new CylinderGeometry(0.043, 0.036, 0.24, 8), cloth, -0.12, fore);
      part(new SphereGeometry(0.045, 8, 6), skin, -0.27, fore);
      return [upper, fore];
    };
    const [ul, fl] = makeArm(1);
    const [ur, fr] = makeArm(-1);
    this.arm = [ul, fl, ur, fr];

    // Legs: dhoti or salwar, and bare feet.
    const makeLeg = (side: 1 | -1): [Group, Group, Mesh] => {
      const hip = new Group();
      hip.position.set(side * body.hip, -0.02, 0);
      hip.rotation.order = "YXZ";
      this.hips.add(hip);
      part(new CylinderGeometry(0.085, 0.07, thigh, 10), lower, -thigh / 2, hip);
      const knee = new Group();
      knee.position.y = -thigh;
      knee.rotation.order = "ZXY";
      hip.add(knee);
      part(new CylinderGeometry(0.068, body.ankle, shin, 10), lower, -shin / 2, knee);
      const foot = part(new SphereGeometry(0.05, 10, 6), skin, -shin - 0.02, knee, 0, 0.05);
      foot.scale.set(0.9, 0.55, 2.1);
      return [hip, knee, foot];
    };
    const [tl, sl, footL] = makeLeg(1);
    const [tr, sr, footR] = makeLeg(-1);
    this.leg = [tl, sl, tr, sr];
    this.feet = [footL, footR];

    this.root.scale.setScalar(body.scale);
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
  }

  /** Begin sitting down (true) or standing up (false). */
  setSeated(seated: boolean): void {
    this.sitTarget = seated ? 1 : 0;
  }

  /** True once the avatar has fully stood up (walking may start). */
  get standing(): boolean {
    return this.sitBlend < 0.02 && this.sitTarget === 0;
  }

  /**
   * @param speed metres per second moved this frame
   * @param travelled total distance walked (drives the stride, so feet don't slide)
   */
  update(dt: number, speed: number, travelled: number): void {
    this.time += dt;
    const step = dt / SIT_S;
    this.sitBlend =
      this.sitTarget > this.sitBlend
        ? Math.min(1, this.sitBlend + step)
        : Math.max(0, this.sitBlend - step);
    const target = Math.min(1, speed / 1.2);
    this.walkAmount += (target - this.walkAmount) * Math.min(1, dt * 8);

    const s = ease(this.sitBlend);
    const w = this.walkAmount * (1 - s);
    const phase = (travelled / CYCLE_M) * Math.PI * 2;
    const breath = Math.sin(this.time * 1.3) * 0.012;
    const [ul, fl, ur, fr] = this.arm;
    const [tl, sl, tr, sr] = this.leg;

    // Hips drop onto the mat when seated; a small bob while walking.
    this.hips.position.y = lerp(this.hipHeight - Math.abs(Math.cos(phase)) * 0.012 * w, 0.17, s);
    this.spine.rotation.set(breath, Math.sin(phase) * 0.06 * w, 0);
    this.head.rotation.x = lerp(0.02, 0.08, s);
    this.skirt.scale.y = lerp(1, 0.35, s);

    // Legs. Standing: swing with the stride. Seated: thighs forward and out, shins crossed (left
    // over right), feet lying along the shins with the soles down, never towards the sanctum.
    const swing = Math.sin(phase) * 0.42 * w;
    const kneeL = Math.max(0, Math.cos(phase)) * 0.75 * w;
    const kneeR = Math.max(0, -Math.cos(phase)) * 0.75 * w;
    tl.rotation.set(lerp(-swing, -1.36, s), lerp(0, 0.95, s), 0);
    tr.rotation.set(lerp(swing, -1.36, s), lerp(0, -0.95, s), 0);
    sl.rotation.set(lerp(kneeL, -0.15, s), 0, lerp(0, -2.3, s));
    sr.rotation.set(lerp(kneeR, 0.12, s), 0, lerp(0, 2.3, s));
    for (const foot of this.feet) foot.rotation.x = lerp(0, 1.4, s);

    // Arms. Standing: hang and swing opposite the legs. Seated: hands rest in the lap.
    const armSwing = Math.sin(phase) * 0.32 * w;
    ul.rotation.set(lerp(armSwing, -0.55, s), 0, lerp(0.07, -0.18, s));
    ur.rotation.set(lerp(-armSwing, -0.55, s), 0, lerp(-0.07, 0.18, s));
    fl.rotation.set(lerp(-0.12 - 0.15 * w, -1.05, s), 0, lerp(0, -0.35, s));
    fr.rotation.set(lerp(-0.12 - 0.15 * w, -1.05, s), 0, lerp(0, 0.35, s));
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
