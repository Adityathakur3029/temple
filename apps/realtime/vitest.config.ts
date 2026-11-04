import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineProject } from "vitest/config";

// Tests run inside workerd with the bindings from wrangler.jsonc (top-level, local config).
export default defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    name: "realtime",
    include: ["test/**/*.test.ts"],
  },
});
