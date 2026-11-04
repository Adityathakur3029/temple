/** `npm run deploy:realtime -- --env staging|production`. Run through the `release` skill. */
import { runWrangler } from "../lib/run";
import { parseTarget } from "./target";

const target = parseTarget(process.argv.slice(2));
console.log(`Deploying the realtime Worker to ${target}…`);
process.exitCode = runWrangler([
  "deploy",
  "--config",
  "apps/realtime/wrangler.jsonc",
  "--env",
  target,
]);
