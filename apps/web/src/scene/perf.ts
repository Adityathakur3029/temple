/**
 * `?perf=1` overlay (spec 10 § Measurement): fps, frame time, draw calls, triangles, textures,
 * geometries and JS heap. A developer tool, so its short technical labels are not localised.
 */
import type { WebGLRenderer } from "three";
import type { Tier } from "../platform/tier";

interface MemoryInfo {
  usedJSHeapSize: number;
}

export class PerfOverlay {
  private readonly el: HTMLElement;
  private frames = 0;
  private total = 0;
  private worst = 0;
  private lastShown = performance.now();

  constructor(
    host: HTMLElement,
    private readonly renderer: WebGLRenderer,
    private readonly tier: () => Tier,
  ) {
    this.el = document.createElement("div");
    this.el.className = "perf";
    this.el.setAttribute("aria-hidden", "true");
    host.append(this.el);
  }

  frame(ms: number): void {
    this.frames++;
    this.total += ms;
    this.worst = Math.max(this.worst, ms);
    const now = performance.now();
    if (now - this.lastShown < 500) return;
    const info = this.renderer.info;
    const heap = (performance as Performance & { memory?: MemoryInfo }).memory?.usedJSHeapSize;
    const avg = this.total / this.frames;
    this.el.textContent = [
      `${(1000 / avg).toFixed(0)} fps  ${avg.toFixed(1)} ms (max ${this.worst.toFixed(0)})`,
      `calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k`,
      `tex ${info.memory.textures}  geo ${info.memory.geometries}`,
      `heap ${heap === undefined ? "n/a" : `${(heap / 1e6).toFixed(0)} MB`}  tier ${this.tier()}`,
      `px ${this.renderer.getPixelRatio().toFixed(2)}`,
    ].join("\n");
    this.frames = 0;
    this.total = 0;
    this.worst = 0;
    this.lastShown = now;
  }

  dispose(): void {
    this.el.remove();
  }
}
