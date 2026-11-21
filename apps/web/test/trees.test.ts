import { TREE_TRUNKS } from "@sannidhi/protocol";
import { describe, expect, it } from "vitest";
import { lawnTrunks } from "../src/scene/trunks";

describe("trees on the lawn", () => {
  it("are the trunks the server blocks (run tools/world/tree-trunks.ts after a layout change)", () => {
    expect(lawnTrunks()).toEqual(TREE_TRUNKS);
  });
});
