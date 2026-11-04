/**
 * Device tiers (spec 10 § Device tiers). The first guess comes from device memory, CPU cores and
 * the WebGL renderer string. After 10 s the measured frame rate can only lower it (adapt.ts), and
 * the visitor can override it in Settings.
 */

export const TIERS = ["low", "mid", "high"] as const;
export type Tier = (typeof TIERS)[number];

/** Fraction of the (capped) device pixel ratio each tier renders at. */
export const RENDER_SCALE: Readonly<Record<Tier, number>> = { low: 0.7, mid: 0.9, high: 1 };
/** High tier caps the device pixel ratio at 2; the others scale down from that cap. */
export const MAX_PIXEL_RATIO = 2;
export const TARGET_FPS: Readonly<Record<Tier, number>> = { low: 30, mid: 30, high: 60 };

export interface DeviceInfo {
  /** `navigator.deviceMemory` in GB (Chromium only; rounded down to a power of two). */
  deviceMemory?: number | undefined;
  /** `navigator.hardwareConcurrency`. */
  cores?: number | undefined;
  /** Unmasked WebGL renderer string, when the browser shares it. */
  renderer?: string | undefined;
  mobile: boolean;
}

const rank = (t: Tier): number => TIERS.indexOf(t);
const lowest = (...ts: Tier[]): Tier => ts.reduce((a, b) => (rank(b) < rank(a) ? b : a));

/** Tier suggested by the GPU name alone. Unknown GPUs get "mid" on phones and "high" elsewhere. */
export function gpuTier(renderer: string | undefined, mobile: boolean): Tier {
  const r = (renderer ?? "").toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/.test(r)) return "low";

  const adreno = /adreno[^0-9]*(\d{3})/.exec(r);
  if (adreno) {
    const n = Number(adreno[1]);
    return n < 600 ? "low" : n < 640 ? "mid" : "high";
  }
  const mali = /mali-?\s*(g|t)?(\d+)/.exec(r);
  if (mali) {
    const n = Number(mali[2]);
    if (mali[1] !== "g" || [31, 51, 52].includes(n)) return "low"; // Mali-T, Mali-4xx, G31–G52
    if (n >= 700 || n === 77 || n === 78) return "high"; // G77, G78, G710 and later
    return "mid"; // G57, G68, G71, G72, G76, G610, G615
  }
  if (/powervr|vivante|videocore/.test(r)) return "low";
  if (/xclipse|immortalis/.test(r)) return "high";
  if (/apple/.test(r)) return mobile ? "mid" : "high";
  if (/intel.*hd graphics/.test(r)) return "mid";
  if (/nvidia|geforce|quadro|radeon|amd|intel|iris|arc/.test(r)) return "high";
  return mobile ? "mid" : "high";
}

/** The starting tier: the lowest of the GPU, memory and core-count suggestions. */
export function chooseTier(d: DeviceInfo): Tier {
  const byGpu = gpuTier(d.renderer, d.mobile);
  const mem = d.deviceMemory;
  const byMemory: Tier = mem === undefined ? "high" : mem <= 2 ? "low" : mem <= 4 ? "mid" : "high";
  const cores = d.cores;
  const byCores: Tier =
    cores === undefined ? "high" : cores <= 2 ? "low" : cores <= 4 ? "mid" : "high";
  return lowest(byGpu, byMemory, byCores);
}

export function lowerTier(t: Tier): Tier | null {
  const i = rank(t);
  return i > 0 ? (TIERS[i - 1] ?? null) : null;
}

export function pixelRatio(tier: Tier, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO) * RENDER_SCALE[tier];
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

interface NavigatorHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}

/** Reads the device hints, probing the GPU name with a throwaway WebGL2 context. */
export function readDeviceInfo(
  nav: NavigatorHints = navigator,
  doc: Document = document,
): DeviceInfo {
  let renderer: string | undefined;
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name: unknown = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      if (typeof name === "string") renderer = name;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // No GPU name: fall back to memory and cores.
  }
  const mobile =
    nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? "");
  return { deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency, renderer, mobile };
}
