import type { SandboxToolDeclaration } from "./capability-types.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import { getSharedCapabilityRegistry } from "./registry-instance.js";

export function declareSandboxTool(declaration: SandboxToolDeclaration): void {
  getSharedCapabilityRegistry().register(declaration);
}

export function getSandboxCapabilityRegistry(): CapabilityRegistry {
  return getSharedCapabilityRegistry();
}
