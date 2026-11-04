/**
 * Smoke test: boot screen, language, unsupported device, the lazy-loaded temple scene,
 * and the realtime Worker reachable from the app origin.
 */
import type { Page } from "@playwright/test";
import { REALTIME, expect, test } from "./fixtures";

/** The h1 as assistive tech reads it: only the current language's text. */
const TITLE = (page: Page) => page.getByRole("heading", { level: 1 });

/** Init script: the browser reports no WebGL2, as on an old or blocklisted GPU. */
const NO_WEBGL2 = (): void => {
  const proto = HTMLCanvasElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "getContext")?.value as (
    this: HTMLCanvasElement,
    ...args: unknown[]
  ) => unknown;
  Object.defineProperty(proto, "getContext", {
    value(this: HTMLCanvasElement, ...args: unknown[]) {
      return args[0] === "webgl2" ? null : original.apply(this, args);
    },
  });
};

test("the temple scene replaces the boot screen", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });

  const canvas = page.locator("canvas.scene");
  await expect(canvas).toBeVisible();
  const isWebGL2 = await canvas.evaluate((c: HTMLCanvasElement) => c.getContext("webgl2") !== null);
  expect(isWebGL2).toBe(true);
  await expect(page.locator(".boot")).toBeHidden();
});

test("the boot screen shows in English by default, with a CSS-only retry link after 15 s", async ({
  page,
}) => {
  await page.route(/\/src\/scene\//, () => {
    // Never answer, so the boot screen stays up.
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(TITLE(page)).toHaveAccessibleName("Sannidhi");
  await expect(page.getByText("Opening the temple doors")).toBeVisible();
  const retry = page.locator(".boot-retry");
  await expect(retry).toBeHidden();
  expect(await retry.evaluate((el) => getComputedStyle(el).animationDelay)).toBe("15s");
});

test("devices without WebGL2 see the unsupported screen", async ({ page }) => {
  await page.addInitScript(NO_WEBGL2);
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "unsupported");
  await expect(page.getByText("This device can't show the temple")).toBeVisible();
  await expect(page.locator("canvas.scene")).toHaveCount(0);
});

test.describe("Hindi", () => {
  test.use({ locale: "hi-IN" });

  test("paints in Hindi, tab title included, even if no module loads", async ({ page }) => {
    // A regex, so a hot-reloaded "/src/main.ts?t=…" is blocked too.
    await page.route(/\/src\/main\.ts(\?.*)?$/, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page).toHaveTitle("सन्निधि");
    await expect(page.getByText("मंदिर के द्वार खुल रहे हैं")).toBeVisible();
  });

  test("is the default for hi-* browsers, and the toggle switches every string", async ({
    page,
  }) => {
    await page.addInitScript(NO_WEBGL2);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(TITLE(page)).toHaveAccessibleName("सन्निधि");
    await expect(page.getByText("यह डिवाइस मंदिर नहीं दिखा सकता")).toBeVisible();
    await expect(page.getByRole("button", { name: "हिन्दी" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page).toHaveTitle("सन्निधि");

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(TITLE(page)).toHaveAccessibleName("Sannidhi");
    await expect(page.getByText("This device can't show the temple")).toBeVisible();
    await expect(page.getByText("यह डिवाइस मंदिर नहीं दिखा सकता")).toBeHidden();
    await expect(page).toHaveTitle("Sannidhi");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("the realtime Worker answers the app origin over HTTP and WebSocket", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async (realtime) => {
    const rooms = (await (await fetch(`${realtime}/api/rooms`)).json()) as { halls: unknown[] };
    const ws = new WebSocket(`${realtime.replace(/^http/, "ws")}/ws?hall=hall-20&v=1`);
    const replies: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("WebSocket error"));
      ws.onmessage = (e) => {
        replies.push(String(e.data));
        // After the welcome, the heartbeat: the runtime answers ping with pong.
        if (replies.length === 1) ws.send("ping");
        if (replies.includes("pong")) resolve();
      };
    });
    ws.send('{"t":"leave"}');
    ws.close(1000);
    const welcome = JSON.parse(replies[0] ?? "{}") as { t?: string; hall?: string };
    return {
      halls: rooms.halls.length,
      welcome: { t: welcome.t, hall: welcome.hall },
      pong: replies.includes("pong"),
    };
  }, REALTIME);

  expect(result.halls).toBe(20);
  expect(result.welcome).toEqual({ t: "welcome", hall: "hall-20" });
  expect(result.pong).toBe(true);
});

test("a hidden tab runs no animation frames (spec 10)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const w = window as Window & { __frames?: number };
    w.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        w.__frames = (w.__frames ?? 0) + 1;
        cb(t);
      });
  });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "temple", { timeout: 60_000 });
  const frames = (): Promise<number> =>
    page.evaluate(() => (window as Window & { __frames?: number }).__frames ?? 0);

  await expect.poll(frames, { timeout: 20_000 }).toBeGreaterThan(5);

  // Hide the page the way switching tabs does.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = await frames();
  await page.waitForTimeout(750);
  // At most the one frame already queued when the tab was hidden.
  expect((await frames()) - before).toBeLessThanOrEqual(1);
});
