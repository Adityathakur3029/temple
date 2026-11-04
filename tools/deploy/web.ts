/**
 * `npm run deploy:web -- --env staging|production`. Run through the `release` skill.
 * Builds the web app, then uploads apps/web/dist to Cloudflare Pages on the target's branch.
 */
import { runNpm, runWrangler } from "../lib/run";
import { PAGES_BRANCH, PAGES_PROJECT, parseTarget } from "./target";

const target = parseTarget(process.argv.slice(2));

console.log(`Building the web app for ${target}…`);
if (runNpm(["run", "build", "-w", "@sannidhi/web"]) !== 0) {
  process.exitCode = 1;
} else {
  console.log(`Deploying to Pages project "${PAGES_PROJECT}", branch "${PAGES_BRANCH[target]}"…`);
  process.exitCode = runWrangler([
    "pages",
    "deploy",
    "apps/web/dist",
    "--project-name",
    PAGES_PROJECT,
    "--branch",
    PAGES_BRANCH[target],
  ]);
}
