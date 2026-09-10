import { resolve } from "node:path";
import type { CapabilityRegistry } from "../capabilities/capability-registry.js";
import type {
  EffectiveSandboxPolicy,
  PolicyDecision,
  PolicyEngine,
  PolicyRequest,
} from "../types.js";
import { expandHome, isDeniedPath, isPathAllowed } from "./path-policy.js";

export function createPolicyEngine(
  policy: EffectiveSandboxPolicy,
  registry: CapabilityRegistry,
): PolicyEngine {
  function checkPath(
    path: string,
    mode: "read" | "write",
    cwd: string,
  ): PolicyDecision {
    const absolute = resolve(cwd, expandHome(path));
    const denied = mode === "read" ? policy.denyRead : policy.denyWrite;
    if (isDeniedPath(absolute, denied)) {
      return { allowed: false, reason: `${mode} denied for ${path}` };
    }
    const roots = mode === "read" ? policy.allowRead : policy.allowWrite;
    if (!isPathAllowed(absolute, roots)) {
      return {
        allowed: false,
        reason: `${mode} outside sandbox roots: ${path}`,
      };
    }
    return { allowed: true };
  }

  return {
    check(request: PolicyRequest): PolicyDecision {
      if (policy.level === "yolo") return { allowed: true };

      // A tool that has not declared its effects cannot be safely inferred.
      const declaration = registry.lookup(request.toolName);
      if (!declaration) {
        if (policy.unknownTools === "deny") {
          return {
            allowed: false,
            reason: `tool ${request.toolName} has no sandbox capability declaration`,
          };
        }
        return { allowed: true };
      }

      for (const path of request.readPaths ?? []) {
        const decision = checkPath(path, "read", request.cwd);
        if (!decision.allowed) return decision;
      }
      for (const path of request.writePaths ?? []) {
        const decision = checkPath(path, "write", request.cwd);
        if (!decision.allowed) return decision;
      }

      const writesFiles = declaration.capabilities.includes("filesystem.write");
      if (policy.level === "r" && writesFiles) {
        return {
          allowed: false,
          reason: "filesystem writes are disabled in r mode",
        };
      }

      return { allowed: true };
    },
    describe: () => policy,
  };
}
