import { defineConfig } from "vitest/config";

// `npm test` runs every workspace's unit tests. Each project has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ["packages/protocol", "apps/web", "apps/realtime", "tools"],
  },
});
