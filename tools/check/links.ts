/**
 * Spec link check (spec 12 § CI gates): every relative Markdown link in CLAUDE.md and specs/
 * must point to an existing file, and to an existing heading when it has a #fragment.
 * Heading anchors follow GitHub's slug rules.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface LinkProblem {
  file: string;
  line: number;
  target: string;
  problem: string;
}

/** GitHub-style anchor: lower-case, punctuation removed, each space becomes a hyphen. */
export function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** Heading text as GitHub renders it: inline links, images, code and emphasis reduced to text. */
function headingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}])[*_](.+?)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
    .trim();
}

/** Lines outside fenced code blocks, with their 1-based line numbers. */
function proseLines(md: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let fence: string | null = null;
  md.split(/\r?\n/).forEach((text, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      return;
    }
    if (fence === null) out.push({ text, line: i + 1 });
  });
  return out;
}

export function headingSlugs(md: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text } of proseLines(md)) {
    const m = /^#{1,6}\s+(.*)$/.exec(text);
    if (!m) continue;
    const base = githubSlug(headingText(m[1] ?? ""));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

export function extractLinks(md: string): { target: string; line: number }[] {
  const links: { target: string; line: number }[] = [];
  for (const { text, line } of proseLines(md)) {
    const prose = text.replace(/`[^`]*`/g, "");
    for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ target: m[1] ?? "", line });
    }
    const ref = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(prose);
    if (ref?.[1]) links.push({ target: ref[1], line });
  }
  return links;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function checkFileLinks(root: string, file: string): LinkProblem[] {
  const abs = resolve(root, file);
  const md = readFileSync(abs, "utf8");
  const problems: LinkProblem[] = [];
  const slugCache = new Map<string, Set<string>>();
  const slugsOf = (path: string): Set<string> => {
    let s = slugCache.get(path);
    if (!s) {
      s = headingSlugs(readFileSync(path, "utf8"));
      slugCache.set(path, s);
    }
    return s;
  };

  for (const { target, line } of extractLinks(md)) {
    if (EXTERNAL.test(target)) continue;
    const hash = target.indexOf("#");
    const pathPart = decodeURI(hash < 0 ? target : target.slice(0, hash));
    const fragment = hash < 0 ? null : decodeURIComponent(target.slice(hash + 1));
    const dest = pathPart === "" ? abs : resolve(dirname(abs), pathPart);
    const rel = relative(root, abs).replace(/\\/g, "/");

    if (!existsSync(dest)) {
      problems.push({ file: rel, line, target, problem: "file not found" });
      continue;
    }
    if (fragment !== null && fragment !== "" && statSync(dest).isFile() && dest.endsWith(".md")) {
      if (!slugsOf(dest).has(fragment.toLowerCase())) {
        problems.push({ file: rel, line, target, problem: `no heading "#${fragment}"` });
      }
    }
  }
  return problems;
}

/** CLAUDE.md plus every Markdown file under specs/. */
export function specFiles(root: string): string[] {
  const specs = readdirSync(join(root, "specs"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("specs", f));
  return ["CLAUDE.md", ...specs.sort()];
}

export function checkSpecLinks(root: string): LinkProblem[] {
  return specFiles(root).flatMap((f) => checkFileLinks(root, f));
}
