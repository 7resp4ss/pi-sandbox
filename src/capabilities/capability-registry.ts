import type { SandboxToolDeclaration } from "./capability-types.js";

export interface CapabilityRegistry {
  register(declaration: SandboxToolDeclaration): void;
  lookup(toolName: string): SandboxToolDeclaration | undefined;
  list(): readonly SandboxToolDeclaration[];
}

// Registering the same tool twice merges declarations so third-party
// extensions can extend built-in tools without replacing them.
function merge(
  current: SandboxToolDeclaration,
  next: SandboxToolDeclaration,
): SandboxToolDeclaration {
  return {
    toolName: current.toolName,
    capabilities: [...new Set([...current.capabilities, ...next.capabilities])],
    paths: mergePaths(current.paths, next.paths),
  };
}

function mergePaths(
  current: SandboxToolDeclaration["paths"],
  next: SandboxToolDeclaration["paths"],
): SandboxToolDeclaration["paths"] {
  if (!current) return next;
  if (!next) return current;

  return {
    read: next.read ?? current.read,
    write: next.write ?? current.write,
  };
}

export function createCapabilityRegistry(): CapabilityRegistry {
  const declarations = new Map<string, SandboxToolDeclaration>();

  return {
    register(declaration) {
      if (!declaration.toolName.trim()) throw new Error("toolName is required");

      const existing = declarations.get(declaration.toolName);
      declarations.set(
        declaration.toolName,
        existing ? merge(existing, declaration) : { ...declaration },
      );
    },
    lookup: (toolName) => declarations.get(toolName),
    list: () => [...declarations.values()],
  };
}
