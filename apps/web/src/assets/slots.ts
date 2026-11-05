/**
 * Asset slots (spec 11 § Slots): the named places in the temple that a model can fill. A slot
 * left empty shows its greybox shape. The asset build (tools/assets) fits, checks and packs each
 * configured model for its slot; the client (scene/models.ts) loads it through the manifest.
 *
 * Plain data with no three.js import, so the Node asset tools can share it.
 */
import { AARTI_PLATE, DEEPA_STAND, FOOTWEAR_RACK, TODAY_BOARD } from "@sannidhi/protocol";
import { PLINTH } from "../scene/ground";

export const SLOT_IDS = [
  "gate",
  "footwear-rack",
  "today-board",
  "footwear",
  "tree",
  "shrine",
  "linga",
  "nandi",
  "mandapa",
  "ganesha-shrine",
  "ganesha",
  "kund",
  "deepa-stand",
  "aarti-plate",
  "bell",
  "mat",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

/** Loading order (spec 10 § Loading priority). */
export type Priority = "P0" | "P1" | "P2";
export const PRIORITIES: readonly Priority[] = ["P0", "P1", "P2"];

export interface SlotSpec {
  /** What goes here, in plain words, for whoever finds or makes the model. */
  label: string;
  /** `single`: one placed model. `instanced`: one model drawn at many places. */
  kind: "single" | "instanced";
  priority: Priority;
  /** A deity or sacred object (spec 08 § Depiction). Tagged `sacred` in the manifest. */
  sacred: boolean;
  /** Triangle budget for one copy (spec 11 § Asset list and budgets). */
  maxTriangles: number;
  /** Instanced slots: how many copies are drawn with Full and with Lite assets. */
  copies?: { full: number; lite: number };
  /** Draw calls: one per material left after the build joins what it can. */
  maxDraws: number;
  /** Largest texture side, Full / Lite tier. */
  texture: { full: number; lite: number };
  /**
   * Automatic fitting of a downloaded model: after any rotation from the config, the model is
   * scaled evenly so its bounding box measures `size` metres along `axis`, then moved so the
   * `origin` point of the box (bottom or top centre) sits at the model's origin.
   */
  fit: { axis: "x" | "y" | "z"; size: number };
  origin: "bottom" | "top";
  /**
   * Single slots: where the model's origin goes, and its turn about +y. A model's front faces +z
   * (the glTF convention) before the turn.
   */
  place?: { x: number; y: number; z: number; yaw: number };
}

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

export const SLOTS: Readonly<Record<SlotId, SlotSpec>> = {
  gate: {
    label:
      "The torana: two pillars and the lintel with its small tower (not the walls); no carved deity figures",
    kind: "single",
    priority: "P0",
    sacred: false,
    maxTriangles: 15_000,
    maxDraws: 2,
    texture: { full: 2048, lite: 1024 },
    fit: { axis: "x", size: 5.6 },
    origin: "bottom",
    place: { x: 0, y: 0, z: 58, yaw: 0 },
  },
  "footwear-rack": {
    label: "Wooden footwear rack outside the gate, shelves at 0.08, 0.36, 0.64 and 0.92 m",
    kind: "single",
    priority: "P0",
    sacred: false,
    maxTriangles: 3_000,
    maxDraws: 1,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "x", size: 3.6 },
    origin: "bottom",
    place: { x: FOOTWEAR_RACK.x, y: 0, z: FOOTWEAR_RACK.z, yaw: 0 },
  },
  "today-board": {
    label: "The painted board beside the path, blank (its text is drawn in code)",
    kind: "single",
    priority: "P0",
    sacred: false,
    maxTriangles: 3_000,
    maxDraws: 1,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 2.02 },
    origin: "bottom",
    place: { x: TODAY_BOARD.x, y: 0, z: TODAY_BOARD.z, yaw: TODAY_BOARD.yaw },
  },
  footwear: {
    label: "One pair of plain chappals, side by side, toes towards +z",
    kind: "instanced",
    priority: "P0",
    sacred: false,
    maxTriangles: 300,
    copies: { full: 50, lite: 50 },
    maxDraws: 1,
    texture: { full: 512, lite: 256 },
    fit: { axis: "x", size: 0.23 },
    origin: "bottom",
  },
  tree: {
    label: "A deodar (Himalayan cedar). One model until tree LODs exist (M5)",
    kind: "instanced",
    priority: "P0",
    sacred: false,
    maxTriangles: 120,
    copies: { full: 300, lite: 120 },
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 10.4 },
    origin: "bottom",
  },
  shrine: {
    label:
      "Garbhagriha, antarala and shikhara with amalaka and kalasha; hollow and empty sanctum (no linga, murti or Nandi inside, no carved deity figures), door to +z",
    kind: "single",
    priority: "P1",
    sacred: false,
    maxTriangles: 45_000,
    maxDraws: 3,
    texture: { full: 2048, lite: 1024 },
    fit: { axis: "y", size: 16.1 },
    origin: "bottom",
    place: { x: 0, y: 0, z: 1.26, yaw: 0 },
  },
  linga: {
    label:
      "Shiva linga on its yoni pitha in plain dark stone: aniconic (no face, eyes or painted marks, no tripundra), a few bilva leaves or flowers at most, no dharapatra; the front (+z) is the spout, which points north",
    kind: "single",
    priority: "P1",
    sacred: true,
    maxTriangles: 6_000,
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 0.92 },
    origin: "bottom",
    place: { x: 0, y: PLINTH + 0.015, z: 0, yaw: QUARTER_TURN },
  },
  nandi: {
    label:
      "Nandi: a traditional seated bull with natural proportions, calm, no cartoon style, no rider; the figure only (the platform stays)",
    kind: "single",
    priority: "P1",
    sacred: true,
    maxTriangles: 8_000,
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "z", size: 1.6 },
    origin: "bottom",
    place: { x: 0, y: 0.5, z: 22.05, yaw: HALF_TURN },
  },
  mandapa: {
    label:
      "Open pillared hall: plinth, steps to +z, 12 pillars, beams and stepped roof; no carved deity figures, no sacred symbols on floors or steps",
    kind: "single",
    priority: "P1",
    sacred: false,
    maxTriangles: 30_000,
    maxDraws: 3,
    texture: { full: 2048, lite: 1024 },
    fit: { axis: "x", size: 15.2 },
    origin: "bottom",
    place: { x: 0, y: 0, z: 12.1, yaw: 0 },
  },
  "ganesha-shrine": {
    label:
      "Small open-fronted stone shrine with a pedestal at 0.75 m, empty (no murti); opening to +z",
    kind: "single",
    priority: "P1",
    sacred: false,
    maxTriangles: 4_000,
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 3.9 },
    origin: "bottom",
    place: { x: -5.3, y: 0, z: 52, yaw: QUARTER_TURN },
  },
  ganesha: {
    label:
      "A small traditional seated Ganesha murti, facing +z; not cartoon, 'cute', toy-like or modern stylised",
    kind: "single",
    priority: "P1",
    sacred: true,
    maxTriangles: 6_000,
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 0.71 },
    origin: "bottom",
    place: { x: -5.375, y: 0.75, z: 52, yaw: QUARTER_TURN },
  },
  kund: {
    label:
      "Square stepped tank: rim at ground level, three 0.6 m steps each 0.25 m lower; no sacred symbols",
    kind: "single",
    priority: "P1",
    sacred: false,
    maxTriangles: 8_000,
    maxDraws: 2,
    texture: { full: 2048, lite: 1024 },
    fit: { axis: "x", size: 10 },
    origin: "top",
    place: { x: 16, y: 0.04, z: 32, yaw: 0 },
  },
  "deepa-stand": {
    label: "Tall brass deepa stand in tiers (flames are added in code)",
    kind: "single",
    priority: "P2",
    sacred: false,
    maxTriangles: 15_000,
    maxDraws: 2,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 2.35 },
    origin: "bottom",
    place: { x: DEEPA_STAND.x, y: 0, z: DEEPA_STAND.z, yaw: 0 },
  },
  "aarti-plate": {
    label: "Wooden stand with a brass aarti plate on top",
    kind: "single",
    priority: "P2",
    sacred: false,
    maxTriangles: 3_000,
    maxDraws: 1,
    texture: { full: 1024, lite: 512 },
    fit: { axis: "y", size: 0.89 },
    origin: "bottom",
    place: { x: AARTI_PLATE.x, y: 0, z: AARTI_PLATE.z, yaw: 0 },
  },
  bell: {
    label: "A brass temple bell, hanging from its top (the chain is drawn in code)",
    kind: "instanced",
    priority: "P2",
    sacred: false,
    maxTriangles: 800,
    copies: { full: 11, lite: 11 },
    maxDraws: 1,
    texture: { full: 512, lite: 256 },
    fit: { axis: "y", size: 0.32 },
    origin: "top",
  },
  mat: {
    label: "A plain woven floor mat, 0.7 m wide (x) and 0.8 m deep (z); no sacred symbols",
    kind: "instanced",
    priority: "P2",
    sacred: false,
    maxTriangles: 100,
    copies: { full: 40, lite: 40 },
    maxDraws: 1,
    texture: { full: 256, lite: 256 },
    fit: { axis: "x", size: 0.7 },
    origin: "bottom",
  },
};

/**
 * Models from all slots together, counting every copy, may use at most this many triangles:
 * what is left of the spec 10 on-screen budgets after avatars and the greybox. Lite assets go
 * to Low phones (≤ 150k on screen), Full assets to Mid and High (Mid ≤ 300k).
 */
export const MODEL_TRIANGLES = { full: 220_000, lite: 100_000 } as const;
/** GPU memory for model textures: half of the Low (120 MB) and Mid (200 MB) budgets. */
export const MODEL_TEXTURE_BYTES = { full: 100_000_000, lite: 60_000_000 } as const;

/**
 * Lite assets aim for half the triangles, except sacred forms, which keep their full detail.
 * Simplifying further is a target, not a limit: the limit is `maxTriangles`.
 */
export function liteTriangleTarget(spec: SlotSpec): number {
  return spec.sacred ? spec.maxTriangles : Math.floor(spec.maxTriangles / 2);
}

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}
