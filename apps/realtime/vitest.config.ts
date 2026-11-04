import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineProject } from "vitest/config";

// Tests run inside workerd with the bindings from wrangler.jsonc (top-level, local config).
// A small per-IP cap lets the cap be tested; sockets without a CF-Connecting-IP header have none.
export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { PER_IP_SOCKET_CAP: "3" } },
    }),
  ],
  test: {
    name: "realtime",
    include: ["test/**/*.test.ts"],
  },
});
