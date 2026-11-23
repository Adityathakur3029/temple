/** Deploys always name their target: `npm run deploy:<part> -- --env staging|production`. */

/**
 * Slots whose built model (an asset manifest entry) is an AI-made sacred form. These are local
 * test models (spec 08 § Depiction), so deploy:web refuses to run while there are any, except
 * to staging with `--allow-ai-test-models` (see allowAiTestModels).
 */
export function aiSacredSlots(manifest: {
  files: readonly { slot: string; tags: readonly string[] }[];
}): string[] {
  const slots = manifest.files
    .filter((f) => f.tags.includes("sacred") && f.tags.includes("ai"))
    .map((f) => f.slot);
  return [...new Set(slots)];
}

export type Target = "staging" | "production";

/**
 * Whether deploy:web may ship AI-made sacred test models: only to staging, and only when asked
 * with `--allow-ai-test-models` (owner, 2026-11-22; spec 08 § Depiction). Production never.
 */
export function allowAiTestModels(target: Target, argv: readonly string[]): boolean {
  return target === "staging" && argv.includes("--allow-ai-test-models");
}

export function parseTarget(argv: readonly string[]): Target {
  const i = argv.findIndex((a) => a === "--env" || a.startsWith("--env="));
  const arg = argv[i];
  const value = arg?.startsWith("--env=") ? arg.slice("--env=".length) : argv[i + 1];
  if (i < 0 || (value !== "staging" && value !== "production")) {
    throw new Error("Name the target: npm run deploy:<part> -- --env staging|production");
  }
  return value;
}

/**
 * The realtime Worker each web build talks to (spec 01 § Environments), passed to Vite as
 * VITE_REALTIME_URL. These are the workers.dev hosts until the domain is chosen (spec 00, open
 * decision 1); the realtime Worker's ALLOWED_ORIGINS name the matching web hosts. Staging never
 * points at production.
 */
export const REALTIME_URLS: Readonly<Record<Target, string>> = {
  staging: "https://sannidhi-realtime-staging.adityathakur-mca18-du-4c6.workers.dev",
  production: "https://sannidhi-realtime-production.adityathakur-mca18-du-4c6.workers.dev",
};
