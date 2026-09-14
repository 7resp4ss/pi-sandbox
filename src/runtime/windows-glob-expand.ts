import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Fast pre-expansion for filesystem glob patterns on Windows.
 *
 * sandbox-runtime's expandGlobPattern() resolves a glob by calling
 * readdirSync(baseDir, { recursive: true }) and regex-testing every entry —
 * a full recursive scan of the static prefix tree, on the main thread, per
 * pattern. The default policy carries cwd-relative globs (".env.*",
 * "*.pem", "*.key"), so on a large workspace (millions of files)
 * SandboxManager.initialize() blocks the event loop for minutes and the
 * TUI appears dead.
 *
 * A pattern without `**` can only match at its own depth: each `*`/`?`
 * segment matches a single path segment. So instead of scanning the whole
 * subtree, walk level by level and descend only into directories that
 * match the corresponding segment — for "*.pem" that is ONE readdir of
 * the base directory. Matches are identical to the runtime's full-regex
 * expansion (its `[^/]*` segments can never cross a directory boundary).
 *
 * Patterns we do not fully understand pass through unchanged (the runtime
 * then expands them itself, slowly but correctly):
 * - `**` patterns (need a real subtree walk)
 * - UNC paths and `\\?\` extended prefixes
 * - `%VAR%` environment references (expanded by the runtime)
 * - non-glob literals (deny-mode placeholder semantics must be preserved:
 *   the runtime passes missing literal deny targets through to srt-win,
 *   which materializes a stamped placeholder — dropping or rewriting them
 *   here would change policy)
 *
 * A glob that matches nothing contributes nothing (the runtime drops
 * glob results that fail stat, so an empty expansion is equivalent).
 */

/** True when the pattern uses glob chars the Windows runtime expands. */
function hasGlobChars(p: string): boolean {
  return p.includes("*") || p.includes("?");
}

/**
 * Segment to regex, mirroring the runtime's globToRegex per path segment:
 * `*` matches any run of non-separator chars, `?` exactly one. Within one
 * segment there are no separators, so `[^/]*` and `.*` coincide.
 * Case-insensitive: the runtime expands with { caseInsensitive: true } on
 * Windows (FAT/NTFS semantics).
 */
function segmentToRegex(segment: string): RegExp {
  const body = segment
    .replace(/[.^$+{}()|\\[\]]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${body}$`, "i");
}

/**
 * Normalize a pattern to an absolute forward-slash spelling for the walk.
 * Returns undefined when the pattern should pass through to the runtime.
 */
function normalizeForWalk(
  pattern: string,
  cwd: string,
  home: string,
): string | undefined {
  if (pattern.includes("%")) return undefined; // env refs: runtime expands
  if (pattern.startsWith("\\\\")) return undefined; // UNC / extended prefix
  if (pattern.includes("**")) return undefined; // needs a subtree walk
  if (!hasGlobChars(pattern)) return undefined; // literal: preserve semantics

  let p = pattern;
  if (p === "~") {
    p = home;
  } else if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = home.replace(/[\\/]+$/, "") + "/" + p.slice(2);
  }
  p = p.replace(/\\/g, "/");
  if (!/^[a-zA-Z]:\//.test(p) && !p.startsWith("/")) {
    p = resolve(cwd, p).replace(/\\/g, "/");
  }
  // Match the runtime's drive-letter uppercase so comparisons align.
  if (/^[a-z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
  return p;
}

/** Expand one normalized absolute glob pattern via a level-by-level walk. */
function walkGlob(normalized: string): string[] {
  const segments = normalized.split("/");
  const firstGlob = segments.findIndex((s) => hasGlobChars(s));
  let baseDir = segments.slice(0, firstGlob).join("/");
  if (baseDir === "") baseDir = "/"; // posix root
  if (/^[a-zA-Z]:$/.test(baseDir)) baseDir += "/"; // drive root

  let currentDirs = [baseDir];
  const matches: string[] = [];
  for (let lvl = firstGlob; lvl < segments.length; lvl++) {
    const re = segmentToRegex(segments[lvl]);
    const isLeaf = lvl === segments.length - 1;
    const nextDirs: string[] = [];
    for (const dir of currentDirs) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir: no matches below it
      }
      for (const entry of entries) {
        if (!re.test(entry.name)) continue;
        const full = join(dir, entry.name);
        if (isLeaf) {
          matches.push(full);
        } else if (entry.isDirectory()) {
          nextDirs.push(full);
        }
      }
    }
    if (isLeaf) return matches;
    currentDirs = nextDirs;
  }
  return matches;
}

/**
 * Resolve a Windows filesystem pattern list to pass to SandboxManager:
 * simple globs are pre-expanded to concrete paths (fast), everything else
 * passes through verbatim. `cwd`/`home` are parameters for testability;
 * callers pass process.cwd()/homedir() to mirror the runtime's resolution.
 */
export function expandWindowsFsGlobs(
  patterns: readonly string[],
  cwd: string,
  home: string,
): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const normalized = normalizeForWalk(pattern, cwd, home);
    if (normalized === undefined) {
      out.push(pattern);
      continue;
    }
    out.push(...walkGlob(normalized));
  }
  return out;
}
