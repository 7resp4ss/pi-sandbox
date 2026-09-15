import type { SandboxCapability } from "../types.ts";

export interface ExtractionContext {
  cwd: string;
}
export type PathExtractor = (
  input: Record<string, unknown>,
  context: ExtractionContext,
) => readonly string[];

export interface SandboxToolDeclaration {
  toolName: string;
  capabilities: readonly SandboxCapability[];
  paths?: { read?: PathExtractor; write?: PathExtractor };
}
