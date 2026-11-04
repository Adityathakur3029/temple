/**
 * `npm run deploy:web -- --env staging|production`. Run through the `release` skill.
 * Builds the web app, then deploys apps/web/dist as the assets-only Worker in
 * apps/web/wrangler.jsonc (spec 01).
 */
import { runNpm, runWrangler } from "../lib/run";
import { parseTarget } from "./target";

const target = parseTarget(process.argv.slice(2));

console.log(`Building the web app for ${target}…`);
if (runNpm(["run", "build", "-w", "@sannidhi/web"]) !== 0) {
  process.exitCode = 1;
} else {
  console.log(`Deploying the web app (static assets) to ${target}…`);
  process.exitCode = runWrangler([
    "deploy",
    "--config",
    "apps/web/wrangler.jsonc",
    "--env",
    target,
  ]);
}
