import type { SandboxToolDeclaration } from "../capabilities/capability-types.ts";

export interface ExtractedPaths {
  readPaths: string[];
  writePaths: string[];
}

// Uses the declaration's extractors when present. Otherwise falls back to the
// built-in convention: `path`/`file_path` is a read path for every tool
// except write (write-only) and edit (read + write).
export function extractPaths(
  toolName: string,
  input: Record<string, unknown>,
  declaration: SandboxToolDeclaration | undefined,
  cwd: string,
): ExtractedPaths {
  if (declaration?.paths) {
    return {
      readPaths: declaration.paths.read
        ? [...declaration.paths.read(input, { cwd })]
        : [],
      writePaths: declaration.paths.write
        ? [...declaration.paths.write(input, { cwd })]
        : [],
    };
  }

  const raw = input.path ?? input.file_path;
  if (typeof raw !== "string") return { readPaths: [], writePaths: [] };
  if (toolName === "write") return { readPaths: [], writePaths: [raw] };
  if (toolName === "edit") return { readPaths: [raw], writePaths: [raw] };
  return { readPaths: [raw], writePaths: [] };
}
