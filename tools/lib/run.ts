/** Cross-platform process helpers for repo scripts. No shell, so Windows and Linux behave the same. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function runNode(script: string, args: string[]): number {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Runs npm with the same npm that started this script (npm sets npm_execpath). */
export function runNpm(args: string[]): number {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !/\.c?js$/.test(npmCli)) {
    throw new Error("Run this through an npm script (for example `npm run check`).");
  }
  return runNode(npmCli, args);
}

export function runWrangler(args: string[]): number {
  const cli = fileURLToPath(
    new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url),
  );
  if (!existsSync(cli)) throw new Error("wrangler is not installed. Run `npm install`.");
  return runNode(cli, args);
}
