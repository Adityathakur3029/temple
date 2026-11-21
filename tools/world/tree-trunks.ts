/**
 * Writes packages/protocol/src/trees.ts: the trunks of the trees the client grows on the lawn,
 * so the server blocks them too. Run after any change to the tree layout:
 *   npx tsx tools/world/tree-trunks.ts
 * apps/web/test/trees.test.ts fails if the table and the client's trees disagree.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lawnTrunks } from "../../apps/web/src/scene/trunks";

const rows = lawnTrunks().map((t) => `  { x: ${t.x}, z: ${t.z}, r: ${t.r} },`);
const out = `/**
 * The trunks of the trees that stand on the lawn inside the compound wall (spec 02 § Layout):
 * visitors walk round them. Generated from the client's tree layout by
 * tools/world/tree-trunks.ts; don't edit by hand. Metres, rounded to 1 cm.
 */
export const TREE_TRUNKS: readonly { x: number; z: number; r: number }[] = [
${rows.join("\n")}
];
`;
const file = fileURLToPath(new URL("../../packages/protocol/src/trees.ts", import.meta.url));
writeFileSync(file, out);
console.log(`${rows.length} trunks written to ${file}`);
