/** True when the browser can create a WebGL2 context (spec 01 § Boot sequence, step 2). */
export function hasWebGL2(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    // Release the probe context so the scene can create its own.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
