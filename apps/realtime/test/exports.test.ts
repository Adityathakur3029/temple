import { describe, expect, it } from "vitest";
import * as main from "../src/worker";

describe("the Worker's main module", () => {
  // workerd treats every named export of the main module as an entrypoint and refuses to start
  // on anything else (a constant, say), which the test pool doesn't catch on its own.
  it("exports only the handler and the Durable Object classes", () => {
    expect(Object.keys(main).sort()).toEqual(["DirectoryDO", "RoomDO", "default"]);
  });
});
