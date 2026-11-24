import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  BELLS,
  CLOSE_CODES,
  GESTURE_COOLDOWN_MS,
  INSTANCE_CAPACITY,
  DOOR_SPOTS,
  JAL_SPOT,
  SANCTUM_SPOTS,
  MATS,
  MAT_COUNT,
  SEATS,
  NANDI_EAR_SPOTS,
  PROTOCOL_VERSION,
  SERVER_IDLE_TIMEOUT_MS,
  SPAWN,
  STRIKE_LIMIT,
  TAP_SPOTS,
  WASH_COOLDOWN_MS,
  nameLabel,
  parseResumeToken,
  type HallId,
  type PosMessage,
  type WelcomeMessage,
} from "@sannidhi/protocol";
import type { RoomDO } from "../src/room";
import { TestClient, wait } from "./client";

function roomStub(hall: HallId, instance = 1): DurableObjectStub<RoomDO> {
  return env.ROOM.get(env.ROOM.idFromName(`${hall}#${instance}`));
}

/** Walks a client from `from` to `to` in steps the movement rule accepts. */
async function walk(
  c: TestClient,
  from: { x: number; z: number },
  to: { x: number; z: number },
): Promise<void> {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.6);
  for (let i = 1; i <= steps; i++) {
    const msg: PosMessage = {
      t: "pos",
      x: from.x + ((to.x - from.x) * i) / steps,
      z: from.z + ((to.z - from.z) * i) / steps,
      yaw: 0,
      pose: "walk",
    };
    c.send(msg);
    await wait(110);
  }
}

describe("joining", () => {
  it("welcomes a visitor with a curated name, spawn place and snapshot", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-02" });
    expect(welcome.v).toBe(PROTOCOL_VERSION);
    expect(welcome.hall).toBe("hall-02");
    expect(welcome.instance).toBe(1);
    expect(parseResumeToken(welcome.resume)).toEqual({ hall: "hall-02", instance: 1 });
    expect(nameLabel(welcome.you.name, "en")).toMatch(/^[A-Z][a-z]+ \d{3}$/);
    expect(welcome.you.shawl).toBeGreaterThanOrEqual(0);
    expect(welcome.you.shawl).toBeLessThan(8);
    const me = welcome.snapshot.states.find(([id]) => id === welcome.you.id);
    expect(me?.slice(1, 3)).toEqual([SPAWN.x, SPAWN.z]);
    expect(me?.[5]).toBe(-1);
    expect(welcome.snapshot.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await c.close();
  });

  it("shows each visitor to the other, and their movement", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-03" });
    const { c: b, welcome: wb } = await TestClient.join({ hall: "hall-03" });
    expect(wb.snapshot.visitors.map((v) => v.id)).toContain(wa.you.id);
    expect(wb.you.name.n).not.toBe(wa.you.name.n);

    const joined = await a.next("delta", (d) => d.join?.some((v) => v.id === wb.you.id) ?? false);
    expect(joined.join?.find((v) => v.id === wb.you.id)?.name).toEqual(wb.you.name);

    const z = SPAWN.z - 0.5;
    a.send({ t: "pos", x: SPAWN.x, z, yaw: 3.14, pose: "walk" });
    const moved = await b.next(
      "delta",
      (d) => d.up?.some(([id, , dz]) => id === wa.you.id && dz === z) ?? false,
    );
    expect(moved.up?.find(([id]) => id === wa.you.id)).toEqual([wa.you.id, 0, z, 3.14, 1, -1]);

    await a.close();
    await b.next("delta", (d) => d.gone?.includes(wa.you.id) ?? false);
    await b.close();
  });

  it("sends Lite sockets fewer deltas", async () => {
    const { c: walker } = await TestClient.join({ hall: "hall-04" });
    const { c: lite } = await TestClient.join({ hall: "hall-04", lite: "1" });
    const { c: full } = await TestClient.join({ hall: "hall-04" });
    await wait(400);
    lite.frames.length = 0;
    full.frames.length = 0;
    await walk(walker, SPAWN, { x: 0, z: SPAWN.z - 3 }); // towards the gate
    await wait(300);
    const deltas = (c: TestClient): number =>
      c.frames.filter((f) => f.startsWith('{"t":"delta"')).length;
    expect(deltas(full)).toBeGreaterThan(deltas(lite));
    expect(deltas(lite)).toBeGreaterThan(0);
    await Promise.all([walker.close(), lite.close(), full.close()]);
  });

  it("fills instances in order and closes with 4001 when one is full", async () => {
    const stub = roomStub("hall-05");
    const direct = async (): Promise<WebSocket> => {
      const res = await stub.fetch(
        new Request(`http://room/ws?hall=hall-05&v=${PROTOCOL_VERSION}`, {
          headers: { Upgrade: "websocket", "x-sannidhi-room": "hall-05#1" },
        }),
      );
      const ws = res.webSocket;
      if (!ws) throw new Error("no socket");
      ws.accept();
      return ws;
    };
    const clients: TestClient[] = [];
    // The directory keeps two places free when it picks, so instance 1 takes 49 through it …
    for (let i = 0; i < INSTANCE_CAPACITY - 1; i++) {
      const { c, welcome } = await TestClient.join({ hall: "hall-05" });
      expect(welcome.instance).toBe(1);
      clients.push(c);
    }
    // … and the next newcomer opens instance 2.
    const { c: next, welcome } = await TestClient.join({ hall: "hall-05" });
    expect(welcome.instance).toBe(2);
    // The room has the final say: it takes one more, then refuses.
    const last = await direct();
    const extra = await direct();
    const closed = new Promise<CloseEvent>((r) => extra.addEventListener("close", r));
    expect((await closed).code).toBe(CLOSE_CODES.INSTANCE_FULL);
    expect((await state(stub)).sockets).toBe(INSTANCE_CAPACITY);
    last.close(1000);
    await Promise.all([...clients, next].map((c) => c.close()));
  });

  it("caps sockets per IP in an instance", async () => {
    const ip = { "CF-Connecting-IP": "203.0.113.9" };
    const ok = [];
    for (let i = 0; i < 3; i++) ok.push((await TestClient.join({ hall: "hall-06" }, ip)).c);
    const extra = await TestClient.open({ hall: "hall-06" }, ip);
    expect((await extra.closed).code).toBe(CLOSE_CODES.TOO_MANY_STRIKES);
    // Another address is fine.
    const other = await TestClient.join(
      { hall: "hall-06" },
      { "CF-Connecting-IP": "203.0.113.10" },
    );
    await Promise.all([...ok, other.c].map((c) => c.close()));
  });
});

describe("movement", () => {
  it("accepts walking and corrects a step into each sacred zone", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-07" });
    const id = welcome.you.id;
    // The first position may be anywhere walkable (view restore after a reload).
    c.send({ t: "pos", x: 0, z: 25, yaw: Math.PI, pose: "stand" });
    expect(await c.none("correct")).toBe(true);

    // A step onto Nandi's platform and the axis is corrected; a step beside it is fine.
    // (Every zone is covered step by step in rules.test.ts.)
    c.send({ t: "pos", x: 0, z: 24.4, yaw: Math.PI, pose: "walk" });
    await wait(150);
    c.send({ t: "pos", x: 0, z: 23.0, yaw: Math.PI, pose: "walk" });
    expect(await c.next("correct")).toEqual({ t: "correct", x: 0, z: 24.4 });
    c.send({ t: "pos", x: 0.5, z: 24.6, yaw: 0, pose: "walk" });
    await wait(150);

    const stub = roomStub("hall-07");
    const place = async (): Promise<{ x: number; z: number }> =>
      runInDurableObject(stub, (room: RoomDO) => {
        const conns = (
          room as unknown as { conns: Map<string, { a: { place: { x: number; z: number } } }> }
        ).conns;
        const p = conns.get(id)?.a.place;
        return { x: p?.x ?? NaN, z: p?.z ?? NaN };
      });
    expect(await place()).toEqual({ x: 0.5, z: 24.6 });

    // Teleporting is too far, and a long step can't hop over the somasutra.
    c.send({ t: "pos", x: 0.5, z: 40, yaw: 0, pose: "walk" });
    expect(await c.next("correct")).toEqual({ t: "correct", x: 0.5, z: 24.6 });
    await c.close();
  });

  it("never lets a visitor sit without a mat", async () => {
    const { c } = await TestClient.join({ hall: "hall-07" });
    c.send({ t: "pos", x: SPAWN.x, z: SPAWN.z - 0.2, yaw: 0, pose: "sit" });
    expect(await c.next("correct")).toEqual({ t: "correct", x: SPAWN.x, z: SPAWN.z });
    await c.close();
  });
});

describe("gestures and bells", () => {
  /** On the approach just outside the torana, within reach of the gate bell. Spawn is 7.5 m out. */
  const AT_GATE = { x: 0, z: BELLS.gate.z + 2 };

  it("shows namaste and pranam to others, once per cooldown", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-08" });
    const { c: b } = await TestClient.join({ hall: "hall-08" });
    a.send({ t: "gesture", g: "namaste" });
    expect(await b.next("event")).toEqual({ t: "event", from: wa.you.id, kind: "namaste" });
    expect(await a.none("event")).toBe(true); // not echoed to the sender
    a.send({ t: "gesture", g: "pranam" }); // within the cooldown: dropped
    expect(await b.none("event", 300)).toBe(true);
    await wait(GESTURE_COOLDOWN_MS);
    a.send({ t: "gesture", g: "pranam" });
    expect((await b.next("event")).kind).toBe("pranam");
    // Take aarti and prasad wait for the aarti window (M4).
    await wait(GESTURE_COOLDOWN_MS);
    a.send({ t: "gesture", g: "aarti" });
    expect(await b.none("event", 300)).toBe(true);
    await Promise.all([a.close(), b.close()]);
  });

  it("rings a bell only within reach", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-09" });
    const { c: b } = await TestClient.join({ hall: "hall-09" });
    // Walk up to the gate: there the gate bell is 2 m away and path-3 about 7.7 m.
    await walk(a, SPAWN, AT_GATE);
    a.send({ t: "bell", bell: "path-3" });
    expect(await b.none("event", 300)).toBe(true);
    await wait(3000);
    a.send({ t: "bell", bell: "gate" });
    expect(await b.next("event")).toEqual({
      t: "event",
      from: wa.you.id,
      kind: "bell",
      bell: "gate",
    });
    expect(
      Math.hypot(BELLS["path-3"].x - AT_GATE.x, BELLS["path-3"].z - AT_GATE.z),
    ).toBeGreaterThan(5);
    await Promise.all([a.close(), b.close()]);
  });

  it("lets each bell sound at most BELL_MAX_PER_SEC times a second", async () => {
    const ringers = await Promise.all(
      Array.from({ length: 6 }, () => TestClient.join({ hall: "hall-10" })),
    );
    const { c: listener } = await TestClient.join({ hall: "hall-10" });
    await Promise.all(ringers.map(({ c }) => walk(c, SPAWN, AT_GATE)));
    await wait(300);
    for (const { c } of ringers) c.send({ t: "bell", bell: "gate" });
    await wait(500);
    const rings = listener.frames.filter((f) => f.includes('"kind":"bell"')).length;
    expect(rings).toBe(2);
    await Promise.all([...ringers.map(({ c }) => c.close()), listener.close()]);
  });
});

describe("wash hands", () => {
  it("washes only at a tap, once per cooldown, and shows it to others", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-09" });
    const { c: b } = await TestClient.join({ hall: "hall-09" });
    // From the spawn, tap-3 is about 4.6 m away: too far.
    a.send({ t: "wash", tap: "tap-3" });
    expect(await b.none("event", 300)).toBe(true);
    await wait(WASH_COOLDOWN_MS);
    const spot = TAP_SPOTS["tap-3"];
    await walk(a, SPAWN, { x: 0, z: spot.z });
    await walk(a, { x: 0, z: spot.z }, spot);
    a.send({ t: "wash", tap: "tap-3" });
    expect(await b.next("event")).toEqual({
      t: "event",
      from: wa.you.id,
      kind: "wash",
      tap: "tap-3",
    });
    expect(await a.none("event")).toBe(true); // not echoed to the sender
    a.send({ t: "wash", tap: "tap-3" }); // within the cooldown: dropped
    expect(await b.none("event", 300)).toBe(true);
    await Promise.all([a.close(), b.close()]);
  }, 20000);
});

describe("whisper to Nandi", () => {
  it("is accepted only beside Nandi's ear, once per cooldown, and shown to others", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-18" });
    const { c: b } = await TestClient.join({ hall: "hall-18" });
    const ear = NANDI_EAR_SPOTS[0];
    if (!ear) throw new Error("no ear spot");
    // First position (anywhere walkable): 2.4 m out from the ear spot, beyond the server's reach.
    const away = { x: ear.x + 2.4, z: ear.z };
    a.send({ t: "pos", x: away.x, z: away.z, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "gesture", g: "whisper" });
    expect(await b.none("event", 300)).toBe(true);
    await wait(GESTURE_COOLDOWN_MS);
    await walk(a, away, ear);
    a.send({ t: "gesture", g: "whisper" });
    expect(await b.next("event")).toEqual({ t: "event", from: wa.you.id, kind: "whisper" });
    expect(await a.none("event")).toBe(true); // not echoed to the sender
    a.send({ t: "gesture", g: "whisper" }); // within the cooldown: dropped
    expect(await b.none("event", 300)).toBe(true);
    await Promise.all([a.close(), b.close()]);
  }, 20000);
});

describe("jal: into the sanctum, one at a time (spec 03 § Offer water, bel patra or a flower)", () => {
  const DOOR_N = DOOR_SPOTS[0] ?? { x: 0.88, z: 3.0 };
  const DOOR_S = DOOR_SPOTS[1] ?? { x: -0.88, z: 3.0 };
  const IN_N = SANCTUM_SPOTS[0] ?? { x: 0.68, z: 0.55 };
  const MID_N = { x: DOOR_N.x, z: IN_N.z + 0.6 };

  /** In along the north lane, from the door spot to the sanctum spot. */
  async function walkIn(c: TestClient): Promise<void> {
    await walk(c, DOOR_N, MID_N);
    await walk(c, MID_N, IN_N);
  }

  it("lets only the holder in, on their lane; passes the turn once they're out; then charanamrit", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-19" });
    const { c: b, welcome: wb } = await TestClient.join({ hall: "hall-19" });
    // First positions may be anywhere walkable: A at the north door spot, B on the south side.
    a.send({ t: "pos", x: DOOR_N.x, z: DOOR_N.z, yaw: 0, pose: "stand" });
    b.send({ t: "pos", x: -1.9, z: 5.0, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "n" });
    expect((await a.next("jal.turn")).req).toBe(1);
    // One queue for both sides: B, at the south spot, waits for A.
    b.send({ t: "jal.request", req: 1, kind: "flower", side: "s" });
    expect(await b.next("jal.queue")).toEqual({ t: "jal.queue", pos: 0 });
    // B may not go in, nor hold the offering pose.
    await walk(b, { x: -1.9, z: 5.0 }, DOOR_S);
    b.send({ t: "pos", x: DOOR_S.x, z: 2.4, yaw: 0, pose: "walk" });
    expect(await b.next("correct")).toEqual({ t: "correct", x: DOOR_S.x, z: DOOR_S.z });
    b.send({ t: "pos", x: DOOR_S.x, z: DOOR_S.z, yaw: 0, pose: "offer" });
    expect(await b.next("correct")).toBeTruthy();
    // An offering from outside the sanctum is ignored.
    a.send({ t: "jal.done", req: 1 });
    expect(await b.none("event", 300)).toBe(true);
    // A walks in along the lane, unhindered, and offers there.
    await walkIn(a);
    a.send({ t: "pos", x: IN_N.x, z: IN_N.z, yaw: 0, pose: "offer" });
    expect(await a.none("correct", 300)).toBe(true);
    // Off the lane inside (towards the linga) is refused.
    a.send({ t: "pos", x: 0.3, z: 0.6, yaw: 0, pose: "stand" });
    expect(await a.next("correct")).toEqual({ t: "correct", x: IN_N.x, z: IN_N.z });
    // Charanamrit before any offering is ignored.
    a.send({ t: "gesture", g: "charanamrit" });
    expect(await b.none("event", 300)).toBe(true);
    await wait(1000);
    a.send({ t: "jal.done", req: 1 });
    expect(await b.next("event")).toEqual({ t: "event", from: wa.you.id, kind: "jal" });
    // A is still inside: the turn waits for them to come out.
    expect(await b.none("jal.turn", 300)).toBe(true);
    await walk(a, IN_N, MID_N);
    await walk(a, MID_N, DOOR_N);
    expect((await b.next("jal.turn")).req).toBe(1);
    // A second offering within the cooldown is refused (after the 1 s rate limit).
    await wait(1000);
    a.send({ t: "jal.request", req: 2, kind: "bilva", side: "n" });
    expect(await a.next("jal.no")).toEqual({ t: "jal.no", req: 2, why: "cooldown" });
    await wait(GESTURE_COOLDOWN_MS);
    a.send({ t: "gesture", g: "charanamrit" });
    expect(await b.next("event")).toEqual({ t: "event", from: wa.you.id, kind: "charanamrit" });
    await wait(GESTURE_COOLDOWN_MS);
    a.send({ t: "gesture", g: "charanamrit" }); // once per offering
    expect(await b.none("event", 300)).toBe(true);
    // A, without the turn now, can't go back in.
    a.send({ t: "pos", x: DOOR_N.x, z: 2.4, yaw: 0, pose: "walk" });
    expect(await a.next("correct")).toEqual({ t: "correct", x: DOOR_N.x, z: DOOR_N.z });
    // B leaves the turn; nobody is waiting, so it's free for anyone not cooling down.
    b.send({ t: "jal.cancel" });
    await wait(150);
    const { c: c3 } = await TestClient.join({ hall: "hall-19" });
    c3.send({ t: "pos", x: JAL_SPOT.x - 0.5, z: JAL_SPOT.z + 0.6, yaw: 0, pose: "stand" });
    await wait(150);
    c3.send({ t: "jal.request", req: 5, kind: "flower", side: "n" });
    expect((await c3.next("jal.turn")).req).toBe(5);
    expect(wb.you.id).not.toBe(wa.you.id);
    await Promise.all([a.close(), b.close(), c3.close()]);
  }, 40000);
});

describe("jal: timeouts and resume", () => {
  const DOOR_N = DOOR_SPOTS[0] ?? { x: 0.88, z: 3.0 };
  const IN_N = SANCTUM_SPOTS[0] ?? { x: 0.68, z: 0.55 };
  const MID_N = { x: DOOR_N.x, z: IN_N.z + 0.6 };

  it("leads a holder out of the sanctum when the turn runs out, and passes it on", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-16" });
    const { c: b } = await TestClient.join({ hall: "hall-16" });
    a.send({ t: "pos", x: DOOR_N.x, z: DOOR_N.z, yaw: 0, pose: "stand" });
    b.send({ t: "pos", x: 1.9, z: 5.6, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "n" });
    await a.next("jal.turn");
    b.send({ t: "jal.request", req: 4, kind: "bilva", side: "n" });
    await b.next("jal.queue");
    await walk(a, DOOR_N, MID_N);
    // Age A's turn past its deadline, then let the alarm pass it on.
    const stub = roomStub("hall-16");
    await runInDurableObject(stub, (room: RoomDO) => {
      const jal = (room as unknown as { jal: { turn: { until: number } | null } }).jal;
      if (jal.turn) jal.turn.until = Date.now() - 1;
    });
    await runDurableObjectAlarm(stub);
    // A is placed at the door spot, outside, and B gets the turn.
    expect(await a.next("correct")).toEqual({ t: "correct", x: DOOR_N.x, z: DOOR_N.z });
    expect((await b.next("jal.turn")).req).toBe(4);
    // A's late jal.done is ignored: nobody sees an offering.
    a.send({ t: "jal.done", req: 1 });
    expect(await b.none("event", 300)).toBe(true);
    await Promise.all([a.close(), b.close()]);
  }, 20000);

  it("keeps a led-out holder at the door after the room hibernates", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-12" });
    a.send({ t: "pos", x: DOOR_N.x, z: DOOR_N.z, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "n" });
    await a.next("jal.turn");
    await walk(a, DOOR_N, MID_N);
    const stub = roomStub("hall-12");
    await runInDurableObject(stub, (room: RoomDO) => {
      const jal = (room as unknown as { jal: { turn: { until: number } | null } }).jal;
      if (jal.turn) jal.turn.until = Date.now() - 1;
    });
    await runDurableObjectAlarm(stub);
    expect(await a.next("correct")).toEqual({ t: "correct", x: DOOR_N.x, z: DOOR_N.z });
    await evictDurableObject(stub); // memory goes; the attachment must hold the door spot
    a.send({ t: "pos", x: DOOR_N.x, z: DOOR_N.z + 0.3, yaw: 0, pose: "walk" });
    expect(await a.none("correct", 400)).toBe(true);
    await a.close();
  }, 20000);

  it("passes on, after a restart, a turn whose holder's resume place ran out", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-18" });
    const { c: b } = await TestClient.join({ hall: "hall-18" });
    const { c: c3 } = await TestClient.join({ hall: "hall-18" });
    a.send({ t: "pos", x: JAL_SPOT.x, z: JAL_SPOT.z, yaw: 0, pose: "stand" });
    b.send({ t: "pos", x: 1.9, z: 5.6, yaw: 0, pose: "stand" });
    c3.send({ t: "pos", x: 2.4, z: 5.6, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "n" });
    await a.next("jal.turn");
    b.send({ t: "jal.request", req: 2, kind: "water", side: "n" });
    await b.next("jal.queue");
    c3.send({ t: "jal.request", req: 3, kind: "water", side: "n" });
    await c3.next("jal.queue");
    // B's network goes; then A gives up, so the turn passes to B, who is away.
    b.ws.close(4999, "network gone");
    await b.closed;
    await wait(100);
    a.send({ t: "jal.cancel" });
    await wait(150);
    // B's resume place runs out while the room is asleep.
    const stub = roomStub("hall-18");
    await runInDurableObject(stub, async (room: RoomDO, state) => {
      const resumes = (room as unknown as { resumes: Map<string, { until: number }> }).resumes;
      for (const [token, rec] of resumes) {
        rec.until = Date.now() - 1;
        await state.storage.put(`resume:${token}`, rec);
      }
    });
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    // The queue isn't stuck: C gets the turn.
    expect((await c3.next("jal.turn")).req).toBe(3);
    await Promise.all([a.close(), c3.close()]);
  }, 20000);

  it("keeps the cooldown and charanamrit across a resume", async () => {
    const { c: a, welcome } = await TestClient.join({ hall: "hall-17" });
    const { c: b } = await TestClient.join({ hall: "hall-17" });
    a.send({ t: "pos", x: DOOR_N.x, z: DOOR_N.z, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "flower", side: "n" });
    await a.next("jal.turn");
    await walk(a, DOOR_N, MID_N);
    await walk(a, MID_N, IN_N);
    a.send({ t: "jal.done", req: 1 });
    expect((await b.next("event")).kind).toBe("flower");
    await walk(a, IN_N, MID_N);
    await walk(a, MID_N, DOOR_N);
    a.ws.close(4999, "network gone");
    await a.closed;
    await wait(100);
    const { c: back } = await TestClient.join({ hall: "hall-17", resume: welcome.resume });
    back.send({ t: "pos", x: JAL_SPOT.x, z: JAL_SPOT.z, yaw: 0, pose: "stand" });
    await wait(150);
    back.send({ t: "jal.request", req: 2, kind: "water", side: "n" });
    expect(await back.next("jal.no")).toEqual({ t: "jal.no", req: 2, why: "cooldown" });
    back.send({ t: "gesture", g: "charanamrit" });
    expect(await b.next("event")).toEqual({
      t: "event",
      from: welcome.you.id,
      kind: "charanamrit",
    });
    await Promise.all([back.close(), b.close()]);
  }, 20000);
});

describe("jal: places kept and freed", () => {
  const SOUTH = { x: -JAL_SPOT.x, z: JAL_SPOT.z };
  const SOUTH_NEAR = { x: -1.9, z: 5.6 };

  it("keeps a place in the queue across a resume, then gives the turn", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-01" });
    const { c: b, welcome: wb } = await TestClient.join({ hall: "hall-01" });
    a.send({ t: "pos", ...SOUTH, yaw: 0, pose: "stand" });
    b.send({ t: "pos", ...SOUTH_NEAR, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "s" });
    await a.next("jal.turn");
    b.send({ t: "jal.request", req: 2, kind: "flower", side: "s" });
    expect(await b.next("jal.queue")).toEqual({ t: "jal.queue", pos: 0 });
    b.ws.close(4999, "network gone");
    await b.closed;
    await wait(100);
    const { c: back } = await TestClient.join({ hall: "hall-01", resume: wb.resume });
    expect(await back.next("jal.queue")).toEqual({ t: "jal.queue", pos: 0 });
    a.send({ t: "jal.cancel" });
    expect((await back.next("jal.turn")).req).toBe(2);
    await Promise.all([a.close(), back.close()]);
  }, 20000);

  it("rebuilds the queue from storage after a restart, and resets the older two-sided value", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-10" });
    a.send({ t: "pos", ...SOUTH, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 3, kind: "bilva", side: "s" });
    await a.next("jal.turn");
    const stub = roomStub("hall-10");
    await evictDurableObject(stub); // drops memory; the socket hibernates
    const turn = await runInDurableObject(stub, (room: RoomDO) => {
      return (room as unknown as { jal: { turn: { id: string; side: number } | null } }).jal.turn;
    });
    expect(turn).toMatchObject({ id: wa.you.id, side: 1 });
    await a.close();

    // The older stored shape (one turn and queue per side) starts empty, and is written back cleaned.
    await runInDurableObject(stub, async (_room: RoomDO, state) => {
      await state.storage.put("queues", {
        jal: [
          { turn: null, queue: [] },
          { turn: null, queue: [] },
        ],
      });
    });
    await evictDurableObject(stub);
    const { c: fresh } = await TestClient.join({ hall: "hall-10" });
    const stored = await runInDurableObject(stub, (_room: RoomDO, state) =>
      state.storage.get<{ jal: unknown }>("queues"),
    );
    expect(stored?.jal).toEqual({ turn: null, queue: [] });
    await fresh.close();
  }, 20000);

  it("frees a place when the resume window runs out", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-08" });
    const { c: b, welcome: wb } = await TestClient.join({ hall: "hall-08" });
    const { c: c3 } = await TestClient.join({ hall: "hall-08" });
    a.send({ t: "pos", ...SOUTH, yaw: 0, pose: "stand" });
    b.send({ t: "pos", ...SOUTH_NEAR, yaw: 0, pose: "stand" });
    c3.send({ t: "pos", x: -2.4, z: 5.6, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "s" });
    await a.next("jal.turn");
    b.send({ t: "jal.request", req: 1, kind: "water", side: "s" });
    await b.next("jal.queue");
    c3.send({ t: "jal.request", req: 1, kind: "water", side: "s" });
    expect(await c3.next("jal.queue")).toEqual({ t: "jal.queue", pos: 1 });
    b.ws.close(4999, "network gone");
    await b.closed;
    await wait(100);
    const stub = roomStub("hall-08");
    await runInDurableObject(stub, async (room: RoomDO, state) => {
      const resumes = (room as unknown as { resumes: Map<string, { until: number }> }).resumes;
      for (const [token, rec] of resumes) {
        if (!token) continue;
        rec.until = Date.now() - 1;
        await state.storage.put(`resume:${token}`, rec);
      }
    });
    await runDurableObjectAlarm(stub);

    // B's place is gone: C moves up to the front of the queue.
    expect(await c3.next("jal.queue")).toEqual({ t: "jal.queue", pos: 0 });
    const late = await TestClient.open({ hall: "hall-08", resume: wb.resume });
    expect((await late.closed).code).toBe(CLOSE_CODES.RESUME_INVALID);
    await Promise.all([a.close(), c3.close()]);
  }, 20000);

  it("passes a held turn on at once after a leave or a strike close", async () => {
    const { c: a } = await TestClient.join({ hall: "hall-14" });
    const { c: b } = await TestClient.join({ hall: "hall-14" });
    const { c: c3 } = await TestClient.join({ hall: "hall-14" });
    a.send({ t: "pos", ...SOUTH, yaw: 0, pose: "stand" });
    b.send({ t: "pos", ...SOUTH_NEAR, yaw: 0, pose: "stand" });
    c3.send({ t: "pos", x: -2.4, z: 5.6, yaw: 0, pose: "stand" });
    await wait(150);
    a.send({ t: "jal.request", req: 1, kind: "water", side: "s" });
    await a.next("jal.turn");
    b.send({ t: "jal.request", req: 2, kind: "water", side: "s" });
    await b.next("jal.queue");
    c3.send({ t: "jal.request", req: 3, kind: "water", side: "s" });
    await c3.next("jal.queue");
    a.send({ t: "leave" });
    await a.closed;
    expect((await b.next("jal.turn")).req).toBe(2);
    for (let i = 0; i <= STRIKE_LIMIT; i++) b.send('{"t":"dance"}');
    expect((await b.closed).code).toBe(CLOSE_CODES.TOO_MANY_STRIKES);
    expect((await c3.next("jal.turn")).req).toBe(3);
    await c3.close();
  }, 20000);
});

describe("mats", () => {
  async function inMandapa(hall: HallId): Promise<{ c: TestClient; id: string }> {
    const { c, welcome } = await TestClient.join({ hall });
    c.send({ t: "pos", x: 4, z: 15.2, yaw: 0, pose: "stand" }); // first position: anywhere walkable
    await wait(150);
    return { c, id: welcome.you.id };
  }

  it("gives one mat to one visitor, and sitting places them on it facing the sanctum", async () => {
    const a = await inMandapa("hall-11");
    const b = await inMandapa("hall-11");
    a.c.send({ t: "sit", req: 1, mat: 7 });
    b.c.send({ t: "sit", req: 2, mat: 7 });
    expect(await a.c.next("sit.ok")).toEqual({ t: "sit.ok", req: 1, mat: 7 });
    expect(await b.c.next("sit.no")).toEqual({ t: "sit.no", req: 2 });

    const m = MATS[7];
    if (!m) throw new Error("no mat 7");
    await walk(a.c, { x: 4, z: 15.2 }, { x: m.x, z: m.z });
    a.c.send({ t: "pos", x: m.x + 0.1, z: m.z, yaw: 0, pose: "sit" });
    const seated = await b.c.next(
      "delta",
      (d) => d.up?.some(([id, , , , pose]) => id === a.id && pose === 2) ?? false,
    );
    const t = seated.up?.find(([id]) => id === a.id);
    expect(t?.slice(1, 3)).toEqual([m.x, m.z]);
    expect(t?.[3]).toBeCloseTo(m.yaw, 2);
    expect(t?.[5]).toBe(7);

    // Standing frees the mat for someone else.
    await wait(1000);
    a.c.send({ t: "stand" });
    await wait(150);
    await wait(1000);
    b.c.send({ t: "sit", req: 3, mat: 7 });
    expect(await b.c.next("sit.ok")).toEqual({ t: "sit.ok", req: 3, mat: 7 });
    await Promise.all([a.c.close(), b.c.close()]);
  });

  it("seats a visitor by a bench on it, facing the temple, and lets them walk off again", async () => {
    const seatNo = MAT_COUNT;
    const s = SEATS[seatNo];
    if (!s) throw new Error("no bench seat");
    const { c: a, welcome } = await TestClient.join({ hall: "hall-13" });
    const b = await inMandapa("hall-13");
    a.send({ t: "pos", x: s.x, z: s.z - 1, yaw: 0, pose: "stand" }); // first position: on the lawn
    await wait(150);
    a.send({ t: "sit", req: 1 });
    expect(await a.next("sit.ok")).toEqual({ t: "sit.ok", req: 1, mat: seatNo });
    // From the mandapa, that bench seat is out of reach (and taken).
    b.c.send({ t: "sit", req: 2, mat: seatNo + 1 });
    expect(await b.c.next("sit.no")).toEqual({ t: "sit.no", req: 2 });

    await walk(a, { x: s.x, z: s.z - 1 }, { x: s.x, z: s.z });
    a.send({ t: "pos", x: s.x, z: s.z, yaw: 0, pose: "sit" });
    const seated = await b.c.next(
      "delta",
      (d) => d.up?.some(([id, , , , pose]) => id === welcome.you.id && pose === 2) ?? false,
    );
    const t = seated.up?.find(([id]) => id === welcome.you.id);
    expect(t?.slice(1, 3)).toEqual([s.x, s.z]);
    expect(t?.[3]).toBeCloseTo(Math.PI, 2);
    expect(t?.[5]).toBe(seatNo);

    // Standing up, the visitor walks away towards the temple; nothing holds them on the bench.
    await wait(1000);
    a.send({ t: "stand" });
    await wait(300);
    await walk(a, { x: s.x, z: s.z }, { x: s.x, z: s.z - 1.2 });
    const away = await b.c.next(
      "delta",
      (d) =>
        d.up?.some(([id, , z]) => id === welcome.you.id && Math.abs(z - (s.z - 1.2)) < 0.02) ??
        false,
    );
    expect(away.up?.find(([id]) => id === welcome.you.id)?.[5]).toBe(-1);
    await Promise.all([a.close(), b.c.close()]);
  });

  it("only seats visitors who are in the mandapa or by a bench", async () => {
    const { c } = await TestClient.join({ hall: "hall-11" });
    c.send({ t: "sit", req: 9 });
    expect(await c.next("sit.no")).toEqual({ t: "sit.no", req: 9 });
    await c.close();
  });
});

describe("resume", () => {
  it("keeps the visitor's id, name, place and mat within the window", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-12" });
    c.send({ t: "pos", x: 4, z: 15.2, yaw: 0, pose: "stand" });
    await wait(150);
    c.send({ t: "sit", req: 1, mat: 3 });
    await c.next("sit.ok");
    c.ws.close(4999, "network gone"); // not a leave
    await c.closed;
    await wait(100);

    // Someone else can't take the held mat.
    const { c: other } = await TestClient.join({ hall: "hall-12" });
    other.send({ t: "pos", x: 4, z: 15.2, yaw: 0, pose: "stand" });
    await wait(150);
    other.send({ t: "sit", req: 5, mat: 3 });
    expect(await other.next("sit.no")).toEqual({ t: "sit.no", req: 5 });

    const { c: back, welcome: again } = await TestClient.join({
      hall: "hall-12",
      resume: welcome.resume,
    });
    expect(again.you).toEqual(welcome.you);
    expect(again.resume).not.toBe(welcome.resume);
    const me = again.snapshot.states.find(([id]) => id === welcome.you.id);
    expect(me?.slice(1, 3)).toEqual([4, 15.2]);
    expect(me?.[5]).toBe(3);
    // A token works once.
    const replay = await TestClient.open({ hall: "hall-12", resume: welcome.resume });
    expect((await replay.closed).code).toBe(CLOSE_CODES.RESUME_INVALID);
    await Promise.all([back.close(), other.close()]);
  });

  it("joins as a new visitor after the window", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-13" });
    c.ws.close(4999, "network gone");
    await c.closed;
    await wait(100);
    // Age the record past the window, then let the alarm expire it.
    const stub = roomStub("hall-13");
    await runInDurableObject(stub, async (room: RoomDO, state) => {
      const resumes = (room as unknown as { resumes: Map<string, { until: number }> }).resumes;
      for (const [token, rec] of resumes) {
        rec.until = Date.now() - 1;
        await state.storage.put(`resume:${token}`, rec);
      }
    });
    const late = await TestClient.open({ hall: "hall-13", resume: welcome.resume });
    expect((await late.closed).code).toBe(CLOSE_CODES.RESUME_INVALID);
    await runDurableObjectAlarm(stub);
    expect(await state(stub)).toMatchObject({ held: 0 });
    const { c: fresh, welcome: w2 } = await TestClient.join({ hall: "hall-13" });
    expect(w2.you.joinedAt).toBeGreaterThan(welcome.you.joinedAt);
    await fresh.close();
  });

  it("frees the place at once after a leave", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-14" });
    c.send({ t: "leave" });
    expect((await c.closed).code).toBe(CLOSE_CODES.NORMAL);
    const again = await TestClient.open({ hall: "hall-14", resume: welcome.resume });
    expect((await again.closed).code).toBe(CLOSE_CODES.RESUME_INVALID);
  });

  it("rejects a token for another hall or a malformed one", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-14" });
    for (const resume of [welcome.resume, "nonsense"]) {
      const other = await TestClient.open({ hall: "hall-15", resume });
      expect((await other.closed).code).toBe(CLOSE_CODES.RESUME_INVALID);
    }
    await c.close();
  });
});

function state(stub: DurableObjectStub<RoomDO>): Promise<ReturnType<RoomDO["stats"]>> {
  return runInDurableObject(stub, (room: RoomDO) => room.stats());
}

describe("abuse", () => {
  it("closes with 4008 after too many strikes", async () => {
    const { c } = await TestClient.join({ hall: "hall-16" });
    for (let i = 0; i <= STRIKE_LIMIT; i++) c.send('{"t":"dance"}');
    expect((await c.closed).code).toBe(CLOSE_CODES.TOO_MANY_STRIKES);
  });

  it("drops messages over the rate limit, with one error", async () => {
    const { c } = await TestClient.join({ hall: "hall-16" });
    for (let i = 0; i < 4; i++) c.send({ t: "stand" });
    expect(await c.next("error")).toEqual({ t: "error", code: "rate_limited" });
    expect(await c.none("error", 300)).toBe(true);
    await c.close();
  });

  it("survives random JSON without closing for anything but strikes", async () => {
    const { c } = await TestClient.join({ hall: "hall-17" });
    const junk = [
      '{"t":"pos","x":1e309}',
      '{"t":"pos","x":"1"}',
      "[]",
      "{",
      '{"t":"sit","req":-1}',
      "x".repeat(2000),
    ];
    for (const j of junk) c.send(j);
    c.send({ t: "time", c: 123 });
    expect(await c.next("time")).toMatchObject({ t: "time", c: 123 });
    await c.close();
  });
});

describe("heartbeat, idle and hibernation", () => {
  it("answers time samples with the server clock", async () => {
    const { c } = await TestClient.join({ hall: "hall-18" });
    const before = Date.now();
    c.send({ t: "time", c: 42 });
    const reply = await c.next("time");
    expect(reply.c).toBe(42);
    expect(Math.abs(reply.s - before)).toBeLessThan(2000);
    await c.close();
  });

  it("closes silent sockets with 4011 in the idle sweep, and holds their place", async () => {
    const { c, welcome } = await TestClient.join({ hall: "hall-19" });
    const stub = roomStub("hall-19");
    await runInDurableObject(stub, (room: RoomDO) => {
      const conns = (room as unknown as { conns: Map<string, { a: { lastAt: number } }> }).conns;
      for (const conn of conns.values()) conn.a.lastAt = Date.now() - SERVER_IDLE_TIMEOUT_MS - 1000;
    });
    await runDurableObjectAlarm(stub);
    expect((await c.closed).code).toBe(CLOSE_CODES.IDLE_TIMEOUT);
    const { c: back, welcome: again } = await TestClient.join({
      hall: "hall-19",
      resume: welcome.resume,
    });
    expect(again.you.id).toBe(welcome.you.id);
    await back.close();
  });

  it("rebuilds visitors from their sockets after hibernation", async () => {
    const { c: a, welcome: wa } = await TestClient.join({ hall: "hall-20" });
    a.send({ t: "pos", x: 0, z: 52, yaw: 1, pose: "stand" });
    await wait(200);
    const stub = roomStub("hall-20");
    await evictDurableObject(stub); // drops memory; the socket hibernates
    const { c: b, welcome: wb } = await TestClient.join({ hall: "hall-20" });
    const seen = wb.snapshot.states.find(([id]) => id === wa.you.id);
    expect(seen?.slice(1, 3)).toEqual([0, 52]);
    expect(wb.snapshot.visitors.find((v) => v.id === wa.you.id)?.name).toEqual(wa.you.name);
    // The hibernated socket still works.
    a.send({ t: "gesture", g: "namaste" });
    expect(await b.next("event")).toMatchObject({ from: wa.you.id, kind: "namaste" });
    await Promise.all([a.close(), b.close()]);
  });
});

describe("privacy", () => {
  it("never logs or stores an IP address, user agent, token or name", async () => {
    const ip = "198.51.100.77";
    const ua = "Mozilla/5.0 (Test Phone) PrivacyCheck/1.0";
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      const headers = { "CF-Connecting-IP": ip, "User-Agent": ua };
      const { c, welcome } = await TestClient.join({ hall: "hall-15" }, headers);
      for (let i = 0; i <= STRIKE_LIMIT; i++) c.send("junk"); // logs a strike close
      await c.closed;
      const again = await TestClient.open(
        { hall: "hall-15", resume: "hall-15.1.AAAAAAAAAAAAAAAAAAAAAA" },
        headers,
      );
      await again.closed; // logs a rejection
      const { c: d } = await TestClient.join({ hall: "hall-15" }, headers);
      d.ws.close(4999, "gone"); // writes a resume record
      await d.closed;
      await wait(100);

      const stored = await runInDurableObject(roomStub("hall-15"), async (_r: RoomDO, s) =>
        JSON.stringify([...(await s.storage.list()).entries()]),
      );
      expect(logs.length).toBeGreaterThan(0);
      for (const text of [...logs, stored]) {
        expect(text).not.toContain(ip);
        expect(text).not.toContain("Test Phone");
      }
      for (const text of logs) {
        expect(text).not.toContain(welcome.resume);
        expect(text).not.toContain(nameLabel(welcome.you.name, "en"));
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe("resume edge cases", () => {
  async function seatedOn(
    hall: HallId,
    mat: number,
  ): Promise<{ c: TestClient; welcome: WelcomeMessage }> {
    const joined = await TestClient.join({ hall });
    joined.c.send({ t: "pos", x: 4, z: 15.2, yaw: 0, pose: "stand" });
    await wait(150);
    joined.c.send({ t: "sit", req: 1, mat });
    await joined.c.next("sit.ok");
    return joined;
  }

  it("takes over a socket the server still thinks is open (Wi-Fi to mobile data)", async () => {
    const { c, welcome } = await seatedOn("hall-13", 2);
    // The old socket is still open here; the visitor comes back on a new one with its token.
    const { c: back, welcome: again } = await TestClient.join({
      hall: "hall-13",
      resume: welcome.resume,
    });
    expect(again.you).toEqual(welcome.you);
    expect(again.snapshot.states.find(([id]) => id === welcome.you.id)?.[5]).toBe(2);
    expect((await c.closed).code).toBe(CLOSE_CODES.NORMAL);
    expect((await state(roomStub("hall-13"))).sockets).toBe(1);
    await back.close();
  });

  it("holds places through a reset that drops sockets without a close event", async () => {
    const { c, welcome } = await seatedOn("hall-09", 5);
    await evictDurableObject(roomStub("hall-09"), { webSockets: "close" });
    await c.closed;
    const { c: back, welcome: again } = await TestClient.join({
      hall: "hall-09",
      resume: welcome.resume,
    });
    expect(again.you.id).toBe(welcome.you.id);
    expect(again.snapshot.states.find(([id]) => id === welcome.you.id)?.[5]).toBe(5);
    await back.close();
  });
});
