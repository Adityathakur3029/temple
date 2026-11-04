/** Helpers for reading the Markdown specs, so tests can assert code ↔ spec parity. */
import { readFileSync } from "node:fs";

export function readSpec(file: string): string {
  return readFileSync(new URL(`../../../specs/${file}`, import.meta.url), "utf8");
}

/** The text under a `## heading`, up to the next `## ` heading. */
export function section(md: string, heading: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`Section "## ${heading}" not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** Body rows of the first Markdown table in `text`, split into trimmed cells. `\|` stays inside a cell. */
export function tableRows(text: string): string[][] {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map((l) =>
      l
        .trim()
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.trim().replace(/\\\|/g, "|")),
    );
  return rows.slice(2); // header and |---| separator
}

/** Every `code span` in a cell. */
export function codeSpans(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
}

/** Every "double-quoted" string in a piece of text. */
export function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}
