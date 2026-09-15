import type { SandboxToolDeclaration } from "./capability-types.ts";
import type { CapabilityRegistry } from "./capability-registry.ts";
import { getSharedCapabilityRegistry } from "./registry-instance.ts";

export function declareSandboxTool(declaration: SandboxToolDeclaration): void {
  getSharedCapabilityRegistry().register(declaration);
}

export function getSandboxCapabilityRegistry(): CapabilityRegistry {
  return getSharedCapabilityRegistry();
}
