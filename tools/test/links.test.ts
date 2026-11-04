import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFileLinks, extractLinks, githubSlug, headingSlugs } from "../check/links";

describe("githubSlug", () => {
  it.each([
    ["Acceptance criteria", "acceptance-criteria"],
    ["Sign-off log", "sign-off-log"],
    ["04 — Realtime protocol", "04--realtime-protocol"],
    ["Client → server messages", "client--server-messages"],
    ["1. Pre-flight (no changes made)", "1-pre-flight-no-changes-made"],
    ["Prior art: sansatemple.com", "prior-art-sansatemplecom"],
    ["Japa mala (जप माला)", "japa-mala-जप-माला"],
    ["snake_case stays", "snake_case-stays"],
  ])("%s → %s", (heading, slug) => {
    expect(githubSlug(heading)).toBe(slug);
  });
});

describe("headingSlugs", () => {
  it("reduces inline markup, numbers duplicates and skips code fences", () => {
    const md = [
      "# Title",
      "## Key numbers (mirror in `packages/protocol/src/constants.ts`)",
      "## **Bold** and [a link](x.md)",
      "## Repeat",
      "## Repeat",
      "```",
      "## Not a heading",
      "```",
    ].join("\n");
    expect([...headingSlugs(md)]).toEqual([
      "title",
      "key-numbers-mirror-in-packagesprotocolsrcconstantsts",
      "bold-and-a-link",
      "repeat",
      "repeat-1",
    ]);
  });
});

describe("extractLinks", () => {
  it("finds inline and reference links outside code", () => {
    const md = [
      "See [04](04-realtime-protocol.md#constants) and [web](https://example.com).",
      "Inline code `[x](nope.md)` is skipped.",
      "```",
      "[also](skipped.md)",
      "```",
      "[ref]: ./other.md",
    ].join("\n");
    expect(extractLinks(md)).toEqual([
      { target: "04-realtime-protocol.md#constants", line: 1 },
      { target: "https://example.com", line: 1 },
      { target: "./other.md", line: 6 },
    ]);
  });
});

describe("checkFileLinks", () => {
  const root = mkdtempSync(join(tmpdir(), "sannidhi-links-"));
  mkdirSync(join(root, "specs"));
  writeFileSync(join(root, "specs", "a.md"), "# A\n## Open decisions\n");
  writeFileSync(
    join(root, "specs", "b.md"),
    [
      "# B",
      "[ok](a.md) [ok anchor](a.md#open-decisions) [self](#b)",
      "[missing file](c.md) [missing anchor](a.md#nope) [external](https://x.test/a.md)",
    ].join("\n"),
  );

  it("reports missing files and headings with line numbers", () => {
    expect(checkFileLinks(root, join("specs", "b.md"))).toEqual([
      { file: "specs/b.md", line: 3, target: "c.md", problem: "file not found" },
      { file: "specs/b.md", line: 3, target: "a.md#nope", problem: 'no heading "#nope"' },
    ]);
  });
});
