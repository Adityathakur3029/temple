import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWebGL2 } from "../src/platform/webgl";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasWebGL2", () => {
  it("is false when no WebGL2 context is available", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(hasWebGL2()).toBe(false);
  });

  it("is false when creating a context throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("GPU process crashed");
    });
    expect(hasWebGL2()).toBe(false);
  });

  it("is true with a context, and releases the probe context", () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(gl as unknown as WebGL2RenderingContext);
    expect(hasWebGL2()).toBe(true);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(loseContext).toHaveBeenCalled();
  });
});
