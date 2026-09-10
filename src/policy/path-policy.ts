import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export function expandHome(path: string): string {
  return path.startsWith("~") ? `${homedir()}${path.slice(1)}` : path;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// A pattern matches either the whole path or a trailing path segment, so
// ".env" matches "/work/.env" and ".env.*" matches "/work/.env.local".
function matchesPattern(candidate: string, pattern: string): boolean {
  const normalizedPattern = expandHome(pattern).replaceAll("\\", "/");
  if (!normalizedPattern.includes("*")) {
    return (
      candidate === normalizedPattern ||
      candidate.endsWith(`/${normalizedPattern}`)
    );
  }

  const escaped = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`(?:^|/)${escaped}$`).test(candidate);
}

export function isPathAllowed(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => inside(expandHome(root), path));
}

export function isDeniedPath(path: string, denied: readonly string[]): boolean {
  const candidate = path.replaceAll("\\", "/");
  return denied.some((pattern) => matchesPattern(candidate, pattern));
}
