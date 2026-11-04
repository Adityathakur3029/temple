import { describe, expect, it } from "vitest";
import { parseTarget } from "../deploy/target";

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
