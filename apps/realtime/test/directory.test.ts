import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { INSTANCE_CAPACITY, INSTANCES_PER_HALL, istDate } from "@sannidhi/protocol";
import { REPORT_STALE_MS, RESERVATION_MS, type DirectoryDO } from "../src/directory";

/** A fresh directory per test, so counts and reservations don't leak between tests. */
function fresh(name: string): DurableObjectStub<DirectoryDO> {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName(name));
}

describe("DirectoryDO.pick", () => {
  it("fills the lowest instance first, keeping two places free", async () => {
    const d = fresh("pick-1");
    await d.report("hall-01", 1, INSTANCE_CAPACITY - 2);
    expect(await d.pick("hall-01")).toEqual({ instance: 1 }); // 2 free
    expect(await d.pick("hall-01")).toEqual({ instance: 2 }); // 1 free is too few
    await d.report("hall-02", 1, 10);
    expect(await d.pick("hall-02")).toEqual({ instance: 1 });
  });

  it("opens instances in order and says full when all are", async () => {
    const d = fresh("pick-2");
    for (let i = 1; i <= INSTANCES_PER_HALL; i++) await d.report("hall-03", i, INSTANCE_CAPACITY);
    expect(await d.pick("hall-03")).toEqual({ full: true });
    await d.report("hall-03", 5, INSTANCE_CAPACITY - 10);
    expect(await d.pick("hall-03")).toEqual({ instance: 5 });
  });

  it("counts pending reservations until they expire", async () => {
    const d = fresh("pick-3");
    const now = Date.now();
    await d.report("hall-04", 1, INSTANCE_CAPACITY - 3);
    expect(await d.pick("hall-04", now)).toEqual({ instance: 1 });
    expect(await d.pick("hall-04", now)).toEqual({ instance: 1 });
    expect(await d.pick("hall-04", now)).toEqual({ instance: 2 });
    expect(await d.pick("hall-04", now + RESERVATION_MS + 1)).toEqual({ instance: 1 });
  });

  it("drops reservations a later report already counts", async () => {
    const d = fresh("pick-5");
    const before = Date.now() - 5000;
    for (let i = 0; i < 30; i++) expect(await d.pick("hall-06", before)).toEqual({ instance: 1 });
    await d.report("hall-06", 1, 30); // all 30 joined
    // Counted once, not twice (30 + 30 would leave no room).
    expect(await d.pick("hall-06")).toEqual({ instance: 1 });
  });

  it("treats a stale report as an empty instance", async () => {
    const d = fresh("pick-4");
    await d.report("hall-05", 1, INSTANCE_CAPACITY);
    expect(await d.pick("hall-05")).toEqual({ instance: 2 });
    expect(await d.pick("hall-05", Date.now() + REPORT_STALE_MS + 1)).toEqual({ instance: 1 });
  });
});

describe("DirectoryDO.rooms", () => {
  it("sums fresh counts per hall", async () => {
    const d = fresh("rooms-1");
    await d.report("hall-06", 1, 50);
    await d.report("hall-06", 2, 7);
    await d.report("hall-06", 3, 0);
    const rooms = await d.rooms();
    expect(rooms.halls[5]).toMatchObject({ id: "hall-06", count: 57, instances: 2 });
    expect(rooms.halls[0]).toMatchObject({ id: "hall-01", count: 0, instances: 0 });
  });
});

describe("today counters", () => {
  it("adds batches per IST date and ignores bad input", async () => {
    const d = fresh("counters-1");
    const today = istDate(Date.now());
    await d.addCounters({ [today]: { visits: 2, diyas: 1 } });
    const after = await d.addCounters({
      [today]: { visits: 1, malas: -5, parikramas: 1.5 },
      nope: { visits: 9 },
    });
    expect(after).toEqual({ date: today, diyas: 1, malas: 0, parikramas: 0, visits: 3 });
  });

  it("rolls over at IST midnight and keeps 7 days", async () => {
    const d = fresh("counters-2");
    const now = Date.now();
    const day = (n: number): string => istDate(now - n * 86_400_000);
    await runInDurableObject(d, async (_o: DirectoryDO, state) => {
      await state.storage.put(`today:${day(8)}`, {
        date: day(8),
        diyas: 0,
        malas: 0,
        parikramas: 0,
        visits: 1,
      });
    });
    await d.addCounters({
      [day(1)]: { visits: 4 },
      [day(6)]: { visits: 1 },
      [day(7)]: { visits: 1 },
    });
    expect((await d.todayCounters()).visits).toBe(0);
    const keys = await runInDurableObject(d, async (_o: DirectoryDO, state) => [
      ...(await state.storage.list({ prefix: "today:" })).keys(),
    ]);
    expect(keys).not.toContain(`today:${day(8)}`);
    expect(keys).toContain(`today:${day(1)}`);
    expect(keys).toContain(`today:${day(6)}`);
    expect(keys).not.toContain(`today:${day(7)}`);
  });

  it("uses the IST date, not UTC, just after midnight IST", () => {
    // 2026-11-03 18:45 UTC is 2026-11-04 00:15 IST.
    expect(istDate(Date.UTC(2026, 10, 3, 18, 45))).toBe("2026-11-04");
  });
});
