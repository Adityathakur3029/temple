import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REALTIME_URLS, parseTarget } from "../deploy/target";

describe("parseTarget", () => {
  it("accepts --env staging|production in both forms", () => {
    expect(parseTarget(["--env", "staging"])).toBe("staging");
    expect(parseTarget(["--env=production"])).toBe("production");
  });

  it("refuses a missing or unknown target", () => {
    for (const argv of [[], ["--env"], ["--env", "prod"], ["--env="], ["staging"]]) {
      expect(() => parseTarget(argv), argv.join(" ")).toThrow(/--env staging\|production/);
    }
  });
});

describe("REALTIME_URLS", () => {
  it("points each web build at its own realtime Worker, never staging at production", () => {
    expect(new URL(REALTIME_URLS.staging).hostname).toMatch(/^sannidhi-realtime-staging\./);
    expect(new URL(REALTIME_URLS.production).hostname).toMatch(/^sannidhi-realtime-production\./);
  });

  it("uses the same workers.dev subdomain as the realtime allow-lists", () => {
    const config = readFileSync(
      new URL("../../apps/realtime/wrangler.jsonc", import.meta.url),
      "utf8",
    );
    for (const url of Object.values(REALTIME_URLS)) {
      const host = new URL(url).hostname.split(".").slice(1).join(".");
      expect(config).toContain(host);
    }
  });
});
