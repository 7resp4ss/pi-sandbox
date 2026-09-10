import type { CapabilityRegistry } from "../capabilities/capability-registry.js";
import type { PolicyEngine } from "../types.js";
import { extractPaths } from "./tool-input-extractors.js";

/**
 * Adapts a pi `tool_call` event to the policy engine: extracts the paths a
 * tool will touch, asks the engine for a decision, and translates a denial
 * into a pi block result.
 */
export function checkToolCall(
  engine: PolicyEngine,
  registry: CapabilityRegistry,
  event: { toolName: string; input: Record<string, unknown> },
  cwd: string,
): { block: true; reason: string } | undefined {
  const declaration = registry.lookup(event.toolName);
  const { readPaths, writePaths } = extractPaths(
    event.toolName,
    event.input,
    declaration,
    cwd,
  );
  const decision = engine.check({
    toolName: event.toolName,
    readPaths,
    writePaths,
    cwd,
  });
  return decision.allowed
    ? undefined
    : { block: true, reason: decision.reason };
}
