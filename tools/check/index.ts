/**
 * `npm run check` (spec 12 § CI gates): typecheck, lint, i18n parity, spec links, then a
 * release build of the web app and the spec 10 size budgets. Runs every step and fails
 * at the end if any step failed.
 */
import { join } from "node:path";
import { compareLocales, readLocales } from "./i18n";
import { checkSpecLinks } from "./links";
import { formatBytes, formatResults, measureWeb, overBudget, uncountedFiles } from "./size";
import { ROOT, runNpm } from "../lib/run";

type Outcome = { name: string; ok: boolean; detail?: string };
const outcomes: Outcome[] = [];

function step(name: string, fn: () => boolean | string[]): boolean {
  console.log(`\n▸ ${name}`);
  let ok: boolean;
  let detail: string | undefined;
  try {
    const result = fn();
    if (Array.isArray(result)) {
      ok = result.length === 0;
      if (!ok) {
        detail = `${result.length} problem(s)`;
        for (const p of result) console.error(`  ✗ ${p}`);
      }
    } else ok = result;
  } catch (err) {
    ok = false;
    detail = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${detail}`);
  }
  outcomes.push(detail === undefined ? { name, ok } : { name, ok, detail });
  return ok;
}

step(
  "TypeScript (tsc --noEmit, every workspace)",
  () => runNpm(["run", "typecheck", "--silent"]) === 0,
);
step("ESLint", () => runNpm(["run", "lint", "--silent"]) === 0);
step("i18n key parity", () => compareLocales(readLocales(join(ROOT, "apps/web/src/i18n"))));
step("Spec links", () =>
  checkSpecLinks(ROOT).map((p) => `${p.file}:${p.line} → ${p.target} (${p.problem})`),
);
const built = step(
  "Web release build",
  () => runNpm(["run", "build", "-w", "@sannidhi/web", "--silent"]) === 0,
);
if (built) {
  step("Size budgets (spec 10)", () => {
    const results = measureWeb(join(ROOT, "apps/web/dist"));
    console.log(formatResults(results).replace(/^/gm, "  "));
    const uncounted = uncountedFiles(join(ROOT, "apps/web/dist"));
    if (uncounted.length > 0) {
      console.log(`  Not counted by any budget line yet: ${uncounted.join(", ")}`);
    }
    return overBudget(results).map(
      (r) => `${r.label}: ${formatBytes(r.bytes ?? 0)} > ${formatBytes(r.limit)}`,
    );
  });
} else {
  outcomes.push({ name: "Size budgets (spec 10)", ok: false, detail: "skipped: build failed" });
}

console.log("\nSummary");
for (const o of outcomes)
  console.log(`  ${o.ok ? "✓" : "✗"} ${o.name}${o.detail ? ` — ${o.detail}` : ""}`);
const failed = outcomes.filter((o) => !o.ok).length;
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
