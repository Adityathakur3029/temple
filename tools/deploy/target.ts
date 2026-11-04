/** Deploys always name their target: `npm run deploy:<part> -- --env staging|production`. */

export type Target = "staging" | "production";

/** Cloudflare Pages project for the web app; branch "main" is production (spec 01 § Environments). */
export const PAGES_PROJECT = "sannidhi";
export const PAGES_BRANCH: Record<Target, string> = { staging: "staging", production: "main" };

export function parseTarget(argv: readonly string[]): Target {
  const i = argv.findIndex((a) => a === "--env" || a.startsWith("--env="));
  const arg = argv[i];
  const value = arg?.startsWith("--env=") ? arg.slice("--env=".length) : argv[i + 1];
  if (i < 0 || (value !== "staging" && value !== "production")) {
    throw new Error("Name the target: npm run deploy:<part> -- --env staging|production");
  }
  return value;
}
