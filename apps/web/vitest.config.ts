import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "web",
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
