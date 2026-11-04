import { describe, expect, it } from "vitest";
import { MANDAPA, MATS, SANCTUM_DOOR, isWalkable, inShape, type Point } from "@sannidhi/protocol";
import {
  CameraRig,
  DARSHAN_LOOK,
  LINGA_FOCUS,
  ORBIT_LIMITS,
  clampOrbit,
  darshanEye,
  insideBox,
  orbitEye,
  pullIn,
  rayBox,
  type Vec3,
} from "../src/scene/camera";
import { CAMERA_BLOCKERS, PLINTH, SANCTUM_BOX, groundY, HEIGHTS } from "../src/scene/ground";

const DEG = Math.PI / 180;

/** Walkable points close to the shrine, where the camera is most likely to swing into it. */
function nearShrine(): Point[] {
  const out: Point[] = [];
  for (let x = -6; x <= 6; x += 0.5) {
    for (let z = -6; z <= 8; z += 0.5) if (isWalkable(x, z)) out.push({ x, z });
  }
  return out;
}

describe("orbit camera (spec 02 § Camera)", () => {
  it("keeps distance and pitch inside the spec's limits", () => {
    const o = clampOrbit({ yaw: 10, pitch: 2, distance: 50 });
    expect(o.pitch).toBe(ORBIT_LIMITS.maxPitch);
    expect(o.distance).toBe(ORBIT_LIMITS.maxDistance);
    expect(ORBIT_LIMITS.minPitch).toBeCloseTo(-10 * DEG);
    expect(ORBIT_LIMITS.maxPitch).toBeCloseTo(35 * DEG);
    expect(ORBIT_LIMITS.minDistance).toBe(2.5);
    expect(ORBIT_LIMITS.maxDistance).toBe(12);
    expect(clampOrbit({ yaw: 0, pitch: -1, distance: 0 })).toEqual({
      yaw: 0,
      pitch: ORBIT_LIMITS.minPitch,
      distance: ORBIT_LIMITS.minDistance,
    });
  });

  it("never enters the garbhagriha or any solid thing, from any angle", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const p of nearShrine()) {
      const target = { x: p.x, y: groundY(p.x, p.z) + 1.45, z: p.z };
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 12) {
        for (const pitch of [ORBIT_LIMITS.minPitch, 0, 20 * DEG, ORBIT_LIMITS.maxPitch]) {
          const eye = pullIn(
            target,
            orbitEye(target, { yaw, pitch, distance: ORBIT_LIMITS.maxDistance }),
          );
          checked++;
          if (CAMERA_BLOCKERS.some((b) => insideBox(eye, b)) || eye.y <= groundY(eye.x, eye.z)) {
            bad.push(JSON.stringify({ p, yaw, pitch, eye }));
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(bad).toEqual([]);
  });

  it("pulls in front of a pillar instead of passing through it", () => {
    const target = { x: 6.5, y: PLINTH + 1.45, z: 11 };
    const eye = pullIn(target, { x: 6.5, y: PLINTH + 1.45, z: 7 });
    expect(eye.z).toBeGreaterThan(10.25);
  });
});

describe("darshan view (spec 02 § Camera, spec 03 § Darshan view)", () => {
  /** Where the line from the eye to the linga crosses the plane of the sanctum door. */
  function atDoor(eye: Vec3): { x: number; y: number } {
    const t = (eye.z - SANCTUM_DOOR.z) / (eye.z - LINGA_FOCUS.z);
    return { x: eye.x + (LINGA_FOCUS.x - eye.x) * t, y: eye.y + (LINGA_FOCUS.y - eye.y) * t };
  }

  const from: [string, Point, boolean][] = [
    ...MATS.map((m, i): [string, Point, boolean] => [`mat ${i}`, m, true]),
    ["the courtyard", { x: -6, z: 26 }, false],
    ["behind the shrine", { x: 2, z: -9 }, false],
    ["the gate", { x: 0, z: 56 }, false],
    ["the mandapa's north edge", { x: 6.2, z: 8 }, false],
  ];

  it.each(from)(
    "from %s, frames the linga through the door from inside the mandapa",
    (_n, p, seated) => {
      const { eye, look } = darshanEye(p, seated);
      expect(inShape(MANDAPA, eye.x, eye.z)).toBe(true);
      expect(look).toEqual(LINGA_FOCUS);
      for (const b of CAMERA_BLOCKERS) expect(insideBox(eye, b)).toBe(false);
      const door = atDoor(eye);
      expect(Math.abs(door.x)).toBeLessThan(SANCTUM_DOOR.halfWidth - 0.2);
      expect(door.y).toBeGreaterThan(PLINTH);
      expect(door.y).toBeLessThan(HEIGHTS.doorTop);
      // Nothing but the sanctum itself is between the eye and the linga.
      const d = { x: LINGA_FOCUS.x - eye.x, y: LINGA_FOCUS.y - eye.y, z: LINGA_FOCUS.z - eye.z };
      const len = Math.hypot(d.x, d.y, d.z);
      const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
      for (const b of CAMERA_BLOCKERS) {
        if (b === SANCTUM_BOX) continue;
        expect(rayBox(eye, dir, len, b), JSON.stringify(b)).toBeNull();
      }
    },
  );

  it("lets a seated visitor look around ±25°, and no further", () => {
    const rig = new CameraRig({ yaw: 0 });
    rig.setMode("darshan", true);
    expect(rig.lookBy(1, 0, true, true)).toBe(false);
    expect(rig.mode).toBe("darshan");
    expect(rig.darshanLook.yaw).toBeCloseTo(DARSHAN_LOOK.yaw);
    expect(DARSHAN_LOOK.yaw).toBeCloseTo(25 * DEG);
    rig.lookBy(-5, 0, true, true);
    expect(rig.darshanLook.yaw).toBeCloseTo(-DARSHAN_LOOK.yaw);
  });

  it("returns to the orbit camera on any look input while standing", () => {
    const rig = new CameraRig({ yaw: 0 });
    rig.setMode("darshan", true);
    expect(rig.lookBy(0.1, 0, false, true)).toBe(true);
    expect(rig.mode).toBe("orbit");
    rig.setMode("darshan", true);
    expect(rig.zoomBy(1.2, false, true)).toBe(true);
    expect(rig.mode).toBe("orbit");
  });

  it("cuts instead of flying through the sanctum", () => {
    const rig = new CameraRig({ yaw: Math.PI });
    const me = { x: 0, z: -9 };
    const head = { x: me.x, y: 1.5, z: me.z };
    rig.update(1 / 30, head, me, false);
    rig.setMode("darshan", false);
    for (let i = 0; i < 40; i++) {
      const pose = rig.update(1 / 30, head, me, false);
      expect(insideBox(pose.eye, SANCTUM_BOX)).toBe(false);
    }
  });

  it("narrows the field of view to frame the door", () => {
    const rig = new CameraRig({ yaw: 0 });
    rig.setMode("darshan", true);
    const mat = MATS[19] ?? { x: 5, z: 14 };
    const pose = rig.update(1, { x: mat.x, y: 1.3, z: mat.z }, mat, true);
    expect(pose.fov).toBeLessThan(30);
    expect(pose.fov).toBeGreaterThanOrEqual(18);
  });
});
