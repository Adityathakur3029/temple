/** Regression tests for the M1 review findings (cultural, perf). */
import { describe, expect, it } from "vitest";
import { MATS, SPAWN } from "@sannidhi/protocol";
import { CameraRig, insideBox } from "../src/scene/camera";
import { CAMERA_BLOCKERS } from "../src/scene/ground";
import { NavGrid } from "../src/scene/nav";
import { Walker } from "../src/scene/walker";

describe("camera flies never pass through anything solid (spec 02 § Camera)", () => {
  it("cuts the fly to the darshan view from behind Nandi instead of passing through him", () => {
    const rig = new CameraRig({ yaw: Math.PI, pitch: -0.17 });
    const me = { x: 0, z: 24.5 };
    const head = { x: me.x, y: 1.5, z: me.z };
    rig.update(1 / 30, head, me, false);
    rig.setMode("darshan", false);
    for (let i = 0; i < 40; i++) {
      const pose = rig.update(1 / 30, head, me, false);
      for (const b of CAMERA_BLOCKERS) expect(insideBox(pose.eye, b)).toBe(false);
    }
  });
});

describe("no sliding while seated (spec 08 § Sacred space, decorum)", () => {
  it("doesn't move along a path while held (the avatar is still standing up)", () => {
    const mat = MATS[2] ?? SPAWN;
    const w = new Walker(mat);
    w.follow([{ x: mat.x, z: mat.z + 3 }]);
    w.hold = true;
    for (let i = 0; i < 30; i++) w.update(1 / 30, null);
    expect(w.x).toBe(mat.x);
    expect(w.z).toBe(mat.z);
    w.hold = false;
    w.update(0.5, null);
    expect(w.z).toBeGreaterThan(mat.z + 0.5);
  });
});

describe("the navigation grid can build in slices (spec 10: input never freezes)", () => {
  it("fills in slices and ends up identical to an eager build", () => {
    const eager = new NavGrid();
    const sliced = new NavGrid(undefined, { deferred: true });
    expect(sliced.ready).toBe(false);
    let slices = 0;
    while (!sliced.buildSome(1)) slices++;
    expect(slices).toBeGreaterThan(2);
    expect(sliced.open).toEqual(eager.open);
  });

  it("finishes a deferred build when a path is asked for", () => {
    const g = new NavGrid(undefined, { deferred: true });
    expect(g.findPath(SPAWN, MATS[0] ?? SPAWN)).not.toBeNull();
    expect(g.ready).toBe(true);
  });
});
