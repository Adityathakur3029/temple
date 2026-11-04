import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Avatar, GESTURE_S } from "../src/scene/avatar";

describe("Avatar", () => {
  it("holds still once seated (no flicker between seated and standing)", () => {
    const a = new Avatar({ shawl: 3, body: 1 });
    a.setSeated(true);
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      a.update(0.05, 0, 0);
      seen.push(a.sitBlend);
    }
    expect(seen.slice(-20).every((b) => b === 1)).toBe(true);
    a.setSeated(false);
    for (let i = 0; i < 60; i++) a.update(0.05, 0, 0);
    expect(a.sitBlend).toBe(0);
    expect(a.standing).toBe(true);
    a.dispose();
  });

  it("plays each gesture for its length, then stops", () => {
    const a = new Avatar({ shawl: 0, body: 0, detail: "low" });
    for (const g of ["namaste", "pranam", "bell"] as const) {
      a.play(g);
      a.update(GESTURE_S[g] / 2, 0, 0);
      expect(a.playing).toBe(g);
      a.update(GESTURE_S[g], 0, 0);
      expect(a.playing).toBeNull();
    }
    a.dispose();
  });

  it("is one skinned mesh, so one draw call", () => {
    const a = new Avatar({ shawl: 1, body: 0 });
    let meshes = 0;
    a.root.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    a.setDetail("low");
    expect(a.detail).toBe("low");
    a.dispose();
  });
});

describe("gesture poses (spec 03)", () => {
  /** Hand and head positions in the avatar's own space, at the middle of a gesture. */
  function pose(g: "namaste" | "pranam") {
    const a = new Avatar({ shawl: 0, body: 0 });
    a.play(g);
    a.update(GESTURE_S[g] / 2, 0, 0);
    const bones = a.mesh.skeleton.bones;
    const at = (bone: number, y: number) =>
      new Vector3(0, y, 0).applyMatrix4(bones[bone]?.matrixWorld ?? new Matrix4());
    // Bone order from avatar.ts: 3 head, 5 left forearm, 7 right forearm.
    const out = { head: at(3, 0.15), left: at(5, -0.27), right: at(7, -0.27) };
    a.dispose();
    return out;
  }

  it("namaste joins the palms at the chest", () => {
    const { head, left, right } = pose("namaste");
    expect(left.distanceTo(right)).toBeLessThan(0.08);
    const below = head.y - (left.y + right.y) / 2;
    expect(below).toBeGreaterThan(0.25);
    expect(below).toBeLessThan(0.45);
  });

  it("pranam raises the joined palms to the forehead, in front of the face", () => {
    const { head, left, right } = pose("pranam");
    expect(left.distanceTo(right)).toBeLessThan(0.08);
    const below = head.y - (left.y + right.y) / 2;
    expect(below).toBeGreaterThan(-0.08);
    expect(below).toBeLessThan(0.1);
  });
});
