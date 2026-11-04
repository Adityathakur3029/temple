import { test as base, expect } from "@playwright/test";

export const REALTIME = "http://localhost:8787";

/** Mobile projects run with a 4x CPU throttle (spec 12 § End-to-end scenarios). */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (testInfo.project.name.startsWith("mobile")) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await use(page);
  },
});

export { expect };
