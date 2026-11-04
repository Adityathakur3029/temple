/**
 * M1 solo temple (spec 13): walking, sacred zones (spec 12 scenario 3), sitting and darshan,
 * language, tabs (scenario 10), idle rest and view restore. Uses the dev-only window.__sannidhi
 * hooks to read state and speed up walking.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

interface State {
  x: number;
  z: number;
  yaw: number;
  mat: number;
  standing: boolean;
  sitBlend: number;
  walking: boolean;
  blocked: string | null;
  inMandapa: boolean;
  camera: { mode: "orbit" | "darshan"; x: number; y: number; z: number };
  activity: string;
  owner: boolean;
  looping: boolean;
}

const SACRED = ["garbhagriha", "nandi-axis", "kund-water", "somasutra"];

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });
  await page.waitForFunction(() => window.__sannidhi !== undefined);
}

const state = (page: Page): Promise<State> =>
  page.evaluate(() => window.__sannidhi?.state() as unknown as State);

/** Walks with tap-to-walk's path-finding at `scale` × speed, checking every 100 ms. */
async function walkTo(page: Page, x: number, z: number, scale = 10): Promise<State[]> {
  await page.evaluate(([s]) => window.__sannidhi?.setTimeScale(s ?? 1), [scale]);
  const ok = await page.evaluate(([px, pz]) => window.__sannidhi?.walkTo(px ?? 0, pz ?? 0), [x, z]);
  expect(ok, `a path to (${x}, ${z})`).toBe(true);
  const seen: State[] = [];
  await expect
    .poll(
      async () => {
        const s = await state(page);
        seen.push(s);
        return s.walking;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(false);
  await page.evaluate(() => window.__sannidhi?.setTimeScale(1));
  return seen;
}

function expectNeverBlocked(states: State[]): void {
  for (const s of states) expect(s.blocked, `at (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`).toBeNull();
}

test.describe.configure({ timeout: 120_000 });

test("arrives just inside the gate, with the HUD ready", async ({ page }) => {
  await open(page);
  const s = await state(page);
  expect(s.x).toBeCloseTo(0, 1);
  expect(s.z).toBeCloseTo(56.5, 1);
  expect(s.blocked).toBeNull();
  await expect(page.getByRole("button", { name: "Darshan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
});

test("walks with the keyboard and with a tap on the path", async ({ page }) => {
  await open(page);
  const before = await state(page);
  await page.keyboard.down("KeyW");
  // Towards the temple (−z). Polled, because slow CI frames walk less per second of wall time.
  await expect
    .poll(async () => before.z - (await state(page)).z, { timeout: 20_000 })
    .toBeGreaterThan(0.5);
  await page.keyboard.up("KeyW");
  const after = await state(page);
  // Mostly forward: W follows the camera, which starts slightly off the axis.
  expect(Math.abs(after.x - before.x)).toBeLessThan((before.z - after.z) / 2);

  // Right of the path, so no hanging bell is between the camera and the tap: a tap on a bell
  // in reach rings it instead of walking (spec 03 § Ring a bell).
  const target = await page.evaluate(() => window.__sannidhi?.screenPoint(1.0, 0.03, 52.5));
  await page.evaluate(() => window.__sannidhi?.setTimeScale(8));
  await page.mouse.click(target?.x ?? 0, target?.y ?? 0);
  await expect.poll(async () => (await state(page)).walking, { timeout: 5000 }).toBe(true);
  await expect.poll(async () => (await state(page)).walking, { timeout: 60_000 }).toBe(false);
  const end = await state(page);
  expect(Math.hypot(end.x - 1.0, end.z - 52.5)).toBeLessThan(1.5);
});

test("no tap or key puts the visitor in the garbhagriha or on the Nandi axis (spec 12 scenario 3)", async ({
  page,
}) => {
  // The longest scenario: eight walks and four key holds, slow under mobile emulation.
  test.setTimeout(300_000);
  await open(page);
  // Tap-to-walk aimed at the linga, the door and the aisle ends beside them, never on them.
  for (const [x, z] of [
    [0, 0],
    [0, 3],
    [0, 12],
  ] as const) {
    const seen = await walkTo(page, x, z);
    expectNeverBlocked(seen);
    expect(SACRED).not.toContain(seen.at(-1)?.blocked);
  }

  // From the threshold beside the door, hold keys towards the sanctum and across the aisle.
  await walkTo(page, 1.9, 3.4);
  await page.evaluate(() => window.__sannidhi?.setTimeScale(4));
  for (const keys of [["KeyA"], ["KeyW"], ["KeyA", "KeyW"], ["KeyD", "KeyS"]]) {
    for (const k of keys) await page.keyboard.down(k);
    const seen: State[] = [];
    for (let i = 0; i < 15; i++) {
      seen.push(await state(page));
      await page.waitForTimeout(100);
    }
    for (const k of keys) await page.keyboard.up(k);
    expectNeverBlocked(seen);
  }

  // A click on the screen where the linga is.
  await walkTo(page, 1.9, 4.6);
  const linga = await page.evaluate(() => window.__sannidhi?.screenPoint(0, 0.9, 0));
  await page.mouse.click(linga?.x ?? 0, linga?.y ?? 0);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__sannidhi?.setTimeScale(8));
  await expect.poll(async () => (await state(page)).walking, { timeout: 60_000 }).toBe(false);
  expect((await state(page)).blocked).toBeNull();
});

test("sits on a mat facing the sanctum, in the darshan view, and stands up", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await walkTo(page, 4, 16);
  await expect(page.getByRole("button", { name: "Sit" })).toBeVisible();
  await page.evaluate(() => window.__sannidhi?.setTimeScale(6));
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await state(page)).sitBlend, { timeout: 60_000 }).toBe(1);
  const s = await state(page);
  expect(s.mat).toBeGreaterThanOrEqual(0);
  // Seated avatars face the linga, within ±10° (spec 02 § Acceptance).
  const toLinga = Math.atan2(-s.x, -s.z);
  const off = Math.abs(Math.atan2(Math.sin(s.yaw - toLinga), Math.cos(s.yaw - toLinga)));
  expect(off).toBeLessThan((10 * Math.PI) / 180);
  expect(s.camera.mode).toBe("darshan");
  await expect(page.getByRole("button", { name: "Darshan" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Stand up" }).click();
  await expect.poll(async () => (await state(page)).mat).toBe(-1);
  expect((await state(page)).camera.mode).toBe("orbit");
});

test("the darshan view looks from the mandapa, and a drag returns to the orbit camera", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("KeyV");
  await expect.poll(async () => (await state(page)).camera.mode).toBe("darshan");
  // The camera flies there; wait for it to land inside the mandapa.
  await expect
    .poll(async () => (await state(page)).camera.z, { timeout: 20_000 })
    .toBeLessThan(18.5);
  const cam = (await state(page)).camera;
  expect(Math.abs(cam.x)).toBeLessThan(7);
  expect(cam.z).toBeGreaterThan(5);

  const box = await page.locator("canvas.scene").boundingBox();
  const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const cy = (box?.y ?? 0) + (box?.height ?? 0) / 3;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).camera.mode).toBe("orbit");
});

test.describe("Hindi", () => {
  test.use({ locale: "hi-IN" });

  test("the HUD and Settings follow the language, and the toggle switches them", async ({
    page,
  }) => {
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("button", { name: "दर्शन" })).toBeVisible();
    await page.getByRole("button", { name: "सेटिंग्स" }).click();
    const sheet = page.getByRole("dialog", { name: "सेटिंग्स" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("लाइट मोड", { exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Picture quality")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Darshan" })).toBeVisible();
  });
});

test("Lite mode and picture quality are kept in settings", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Lite mode").check();
  await page.getByLabel("Low", { exact: true }).check();
  await page.getByRole("button", { name: "Close" }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__sannidhi?.state()))?.lite)
    .toBe(true);
  const stored = await page.evaluate(() => localStorage.getItem("sannidhi:settings-v1"));
  expect(JSON.parse(stored ?? "{}")).toMatchObject({ lite: true, tier: "low" });
});

test("a second tab takes over rendering; the first rests until 'Continue here' (spec 12 scenario 10)", async ({
  page,
  context,
}) => {
  await open(page);
  const second = await context.newPage();
  await open(second);
  await expect(page.getByText("Resting in another tab")).toBeVisible();
  expect((await state(page)).looping).toBe(false);
  expect((await state(second)).looping).toBe(true);

  await page.getByRole("button", { name: "Continue here" }).click();
  await expect.poll(async () => (await state(page)).looping).toBe(true);
  await expect(second.getByText("Resting in another tab")).toBeVisible();
  expect((await state(second)).looping).toBe(false);
});

test("rests after the idle time and returns on a tap (spec 10)", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__sannidhi?.setIdleTimeout(1500));
  const resting = page.getByRole("button", { name: "Resting. Tap to return." });
  await expect(resting).toBeVisible({ timeout: 10_000 });
  expect((await state(page)).looping).toBe(false);
  // Back to the real 3 minutes, so the page can't fall asleep again before the check below.
  await page.evaluate(() => window.__sannidhi?.setIdleTimeout(180_000));
  await resting.click();
  await expect.poll(async () => (await state(page)).activity).toBe("active");
  expect((await state(page)).looping).toBe(true);
});

test("a reload within 30 minutes returns to the same place and view (spec 10)", async ({
  page,
}) => {
  await open(page);
  await walkTo(page, -6, 26);
  await page.waitForTimeout(2500); // the view is checkpointed every 2 s
  const before = await state(page);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });
  const after = await state(page);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.z).toBeCloseTo(before.z, 1);
});

test("walks gate → mandapa → round the pradakshina path without touching a sacred zone (M1 exit route)", async ({
  page,
}) => {
  await open(page);
  const route: [number, number][] = [
    [3.2, 15], // in the mandapa, beside the mats
    [0, 24], // E, in front of Nandi
    [-10.5, 8], // S
    [0, -8], // W
    [10.5, -4], // N, just before the somasutra
    [0, -8], // back to W, then S and E (half pradakshina)
    [-10.5, 8],
    [0, 24],
  ];
  for (const [x, z] of route) {
    const seen = await walkTo(page, x, z, 12);
    expectNeverBlocked(seen);
    const end = seen.at(-1);
    expect(Math.hypot((end?.x ?? 0) - x, (end?.z ?? 0) - z)).toBeLessThan(0.2);
  }
});
