import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

// Software WebGL so the scene renders the same on CI runners without a GPU.
const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/**
 * End-to-end tests (spec 12) against the same two servers `npm run dev` starts:
 * realtime on :8787 and web on :5173.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: GL_ARGS } },
    },
    {
      // Pixel-class viewport with touch; the 4x CPU throttle is applied in e2e/fixtures.ts.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], launchOptions: { args: GL_ARGS } },
    },
  ],
  webServer: [
    {
      command: "npm run dev:realtime",
      cwd: "../..",
      url: "http://localhost:8787/api/rooms",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:web",
      cwd: "../..",
      url: "http://localhost:5173",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
