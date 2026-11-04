/**
 * M2 presence (spec 13), against `wrangler dev`: two visitors (spec 12 scenario 2) and reconnect
 * (scenario 9). Each test uses its own hall (the dev-only `?hall=` parameter), so tests never see
 * each other's visitors or held mats. The dev-only window.__sannidhi hooks read state.
 */
import type { Browser, BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures";

interface Net {
  status: string;
  hall: string | null;
  instance: number | null;
  you: { id: string; name: { key: string; n: number } } | null;
  remotes: { id: string; x?: number; z?: number; pose?: number; mat?: number }[];
  footwear: number;
  gestures: Record<string, string>;
  events: { kind: string; from: string; at: number }[];
}

interface State {
  x: number;
  z: number;
  mat: number;
  sitBlend: number;
  walking: boolean;
}

const net = (page: Page): Promise<Net> =>
  page.evaluate(() => window.__sannidhi?.net() as unknown as Net);
const state = (page: Page): Promise<State> =>
  page.evaluate(() => window.__sannidhi?.state() as unknown as State);

async function open(page: Page, hall: string): Promise<Net> {
  await page.goto(`/?hall=${hall}`);
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });
  await page.waitForFunction(() => window.__sannidhi !== undefined);
  await expect.poll(async () => (await net(page)).status, { timeout: 30_000 }).toBe("online");
  return net(page);
}

/** A second visitor: its own browser context, so its own storage and tab ownership. */
async function visitor(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const context = await browser.newContext({
    baseURL: "http://localhost:5173",
    ...(viewport ? { viewport } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
  });
  return { context, page: await context.newPage() };
}

/** Walk with tap-to-walk's path-finding. `scale` > 1 fast-forwards, which goes offline meanwhile. */
async function walkTo(page: Page, x: number, z: number, scale = 1): Promise<void> {
  await page.evaluate((s) => window.__sannidhi?.setTimeScale(s), scale);
  expect(
    await page.evaluate(([px, pz]) => window.__sannidhi?.walkTo(px ?? 0, pz ?? 0), [x, z]),
  ).toBe(true);
  await expect.poll(async () => (await state(page)).walking, { timeout: 90_000 }).toBe(false);
  await page.evaluate(() => window.__sannidhi?.setTimeScale(1));
}

/**
 * Proxies the page's socket to the server, so a test can cut the network: while `cut` is true,
 * open sockets are dropped and new ones refused, as if the phone lost signal.
 */
async function cuttable(page: Page): Promise<{ cut: (on: boolean) => void }> {
  let cut = false;
  const open = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    if (cut) {
      void ws.close({ code: 4999, reason: "no network" });
      return;
    }
    const server = ws.connectToServer();
    open.add(ws);
    ws.onClose(() => {
      open.delete(ws);
      void server.close();
    });
  });
  return {
    cut: (on) => {
      cut = on;
      if (on) for (const ws of open) void ws.close({ code: 4999, reason: "no network" });
    },
  };
}

test.describe.configure({ timeout: 240_000 });

test("two visitors see each other walk and greet (spec 12 scenario 2)", async ({
  page,
  browser,
}) => {
  const a = await open(page, "hall-17");
  const other = await visitor(browser);
  const b = await open(other.page, "hall-17");
  expect(b.instance).toBe(a.instance);
  const aId = a.you?.id ?? "";
  const bId = b.you?.id ?? "";

  // Each sees the other, and one more pair of footwear at the gate.
  await expect.poll(async () => (await net(other.page)).remotes.map((r) => r.id)).toContain(aId);
  await expect.poll(async () => (await net(page)).remotes.map((r) => r.id)).toContain(bId);
  expect((await net(page)).footwear).toBe(2);
  await expect(page.getByRole("button", { name: "2 here" })).toBeVisible();

  // A walks a few steps; B sees A move while A is still walking, and arrive where A did.
  await page.evaluate(() => window.__sannidhi?.walkTo(0.4, 53.5));
  await expect
    .poll(async () => (await net(other.page)).remotes.find((r) => r.id === aId)?.z ?? 99, {
      timeout: 5000,
    })
    .toBeLessThan(56.2);
  expect((await state(page)).walking).toBe(true);
  await expect.poll(async () => (await state(page)).walking, { timeout: 30_000 }).toBe(false);
  const end = await state(page);
  await expect
    .poll(async () => {
      const r = (await net(other.page)).remotes.find((x) => x.id === aId);
      return Math.hypot((r?.x ?? 99) - end.x, (r?.z ?? 99) - end.z);
    })
    .toBeLessThan(0.05);

  // A greets; B's avatar of A plays the namaste, within 300 ms locally (with test slack).
  const sentAt = await page.evaluate(() => Date.now());
  await page.keyboard.press("Digit3");
  await expect
    .poll(async () =>
      (await net(other.page)).events.find((e) => e.kind === "namaste" && e.from === aId),
    )
    .toBeTruthy();
  const got = (await net(other.page)).events.find((e) => e.kind === "namaste" && e.from === aId);
  expect((got?.at ?? Infinity) - sentAt).toBeLessThan(
    test.info().project.name.startsWith("mobile") ? 1500 : 600,
  );
  await expect.poll(async () => (await net(other.page)).gestures[aId]).toBe("namaste");
  // A repeat within the cooldown is ignored.
  await page.keyboard.press("Digit3");
  await page.waitForTimeout(800);
  expect((await net(other.page)).events.filter((e) => e.kind === "namaste").length).toBe(1);

  // Who's here lists both, in the viewer's language.
  await other.page.getByRole("button", { name: "2 here" }).click();
  const sheet = other.page.getByRole("dialog", { name: "Who's here" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("(you)")).toBeVisible();
  await expect(sheet.locator(".who-list li")).toHaveCount(2);
  await other.context.close();
  await expect.poll(async () => (await net(page)).remotes.length).toBe(0);
});

test("a dropped network keeps the visitor's name and mat for 60 s (spec 12 scenario 9)", async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000);
  const net1 = await cuttable(page);
  await open(page, "hall-18");
  const other = await visitor(browser);
  await open(other.page, "hall-18");

  // Into the mandapa (fast, offline), then "Sit": the server holds a mat and A walks to it.
  await walkTo(page, 4, 15.5, 10);
  await expect.poll(async () => (await net(page)).status, { timeout: 30_000 }).toBe("online");
  await page.getByRole("button", { name: "Sit" }).click();
  await expect.poll(async () => (await state(page)).sitBlend, { timeout: 60_000 }).toBe(1);
  const seated = await state(page);
  const before = await net(page);
  const id = before.you?.id ?? "";
  expect(seated.mat).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => (await net(other.page)).remotes.find((r) => r.id === id)?.mat)
    .toBe(seated.mat);

  // 20 s without network: the same visitor, name and mat come back.
  net1.cut(true);
  await expect.poll(async () => (await net(page)).status).toBe("reconnecting");
  await expect
    .poll(async () => (await net(other.page)).remotes.some((r) => r.id === id))
    .toBe(false);
  await page.waitForTimeout(20_000);
  net1.cut(false);
  await expect.poll(async () => (await net(page)).status, { timeout: 30_000 }).toBe("online");
  const back = await net(page);
  expect(back.you).toEqual(before.you);
  expect((await state(page)).mat).toBe(seated.mat);
  await expect
    .poll(async () => (await net(other.page)).remotes.find((r) => r.id === id)?.mat)
    .toBe(seated.mat);

  // 90 s without network: a new visitor.
  net1.cut(true);
  await page.waitForTimeout(90_000);
  net1.cut(false);
  await expect.poll(async () => (await net(page)).status, { timeout: 60_000 }).toBe("online");
  expect((await net(page)).you?.id).not.toBe(id);
  await other.context.close();
});

test("a server close with 4002 asks the visitor to refresh (spec 12 scenario 9)", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    void ws.close({ code: 4002, reason: "version" });
  });
  await page.goto("/?hall=hall-19");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });
  await expect(page.getByText("A new version is ready. Refresh to continue.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
});

test("rings a bell in reach, and others see it swing", async ({ page, browser }) => {
  const a = await open(page, "hall-16");
  const other = await visitor(browser);
  await open(other.page, "hall-16");
  // The gate bell is 1.5 m from the spawn.
  await expect(page.getByRole("button", { name: "Ring bell" })).toBeVisible();
  await page.keyboard.press("KeyE");
  await expect
    .poll(async () =>
      (await net(other.page)).events.some((e) => e.kind === "bell" && e.from === a.you?.id),
    )
    .toBe(true);
  await other.context.close();
});
