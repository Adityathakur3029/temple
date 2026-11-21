/**
 * The trunks of the trees that grow on the lawn, as world.ts's TREE_TRUNKS lists them. Kept out
 * of greybox.ts's mesh code so the generator and the test share one rule.
 */
import { LAWN, inShape } from "@sannidhi/protocol";
import { treeSpots } from "./greybox";

/** Base radius of each tree's trunk at scale 1 (greybox deodar and oak), plus a little room. */
const TRUNK_BASE = { deodar: 0.28, oak: 0.34 } as const;
const ROOM = 0.05;

const cm = (v: number): number => Math.round(v * 100) / 100;

/** Trunks whose circle reaches onto the lawn. */
export function lawnTrunks(): { x: number; z: number; r: number }[] {
  return treeSpots()
    .map((p) => ({ x: cm(p.x), z: cm(p.z), r: cm(TRUNK_BASE[p.kind] * Math.max(p.w, p.d) + ROOM) }))
    .filter((t) =>
      LAWN.some((l) =>
        inShape(
          { kind: "rect", x0: l.x0 - t.r, x1: l.x1 + t.r, z0: l.z0 - t.r, z1: l.z1 + t.r },
          t.x,
          t.z,
        ),
      ),
    )
    .sort((a, b) => a.z - b.z || a.x - b.x);
}
