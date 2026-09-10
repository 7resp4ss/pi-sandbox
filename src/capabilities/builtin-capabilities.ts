import type { CapabilityRegistry } from "./capability-registry.js";

export function registerBuiltinCapabilities(
  registry: CapabilityRegistry,
): void {
  const readOnlyTools = ["read", "grep", "find", "ls"];
  for (const toolName of readOnlyTools) {
    registry.register({ toolName, capabilities: ["filesystem.read"] });
  }
  registry.register({ toolName: "write", capabilities: ["filesystem.write"] });
  registry.register({
    toolName: "edit",
    capabilities: ["filesystem.read", "filesystem.write"],
  });
  registry.register({ toolName: "bash", capabilities: ["process.execute"] });
  registry.register({
    toolName: "powershell",
    capabilities: ["process.execute"],
  });

  // `agent.spawn` remains part of the public capability vocabulary so the
  // future subagent broker can use the same declaration protocol. It is not
  // registered as a built-in tool until child-policy inheritance is enforced.
}
