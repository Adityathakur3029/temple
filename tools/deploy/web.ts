/**
 * `npm run deploy:web -- --env staging|production`. Run through the `release` skill.
 * Builds the web app for that environment (VITE_REALTIME_URL names its realtime Worker), then
 * deploys apps/web/dist as the assets-only Worker in apps/web/wrangler.jsonc (spec 01).
 * Refuses while an AI-made sacred form is built, since those are local test models (spec 08).
 */
import { readManifest } from "../assets/inputs";
import { runNpm, runWrangler } from "../lib/run";
import { REALTIME_URLS, aiSacredSlots, parseTarget } from "./target";

function main(): number {
  const target = parseTarget(process.argv.slice(2));

  const testModels = aiSacredSlots(readManifest());
  if (testModels.length > 0) {
    console.error(
      `Not deploying: ${testModels.join(", ")} ${testModels.length === 1 ? "is an AI-made test model" : "are AI-made test models"}, ` +
        "for this computer only (spec 08 § Depiction). Put the downloaded stand-in back in " +
        "assets-src/slots.json, run `npm run assets:build`, then deploy again.",
    );
    return 1;
  }

  process.env.VITE_REALTIME_URL = REALTIME_URLS[target];
  console.log(`Building the web app for ${target} (realtime: ${REALTIME_URLS[target]})…`);
  if (runNpm(["run", "build", "-w", "@sannidhi/web"]) !== 0) return 1;

  console.log(`Deploying the web app (static assets) to ${target}…`);
  return runWrangler(["deploy", "--config", "apps/web/wrangler.jsonc", "--env", target]);
}

process.exitCode = main();
