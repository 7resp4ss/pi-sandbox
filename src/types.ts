export type SandboxLevel = "r" | "w" | "yolo";

export type SandboxCapability =
  | "filesystem.read"
  | "filesystem.write"
  | "process.execute"
  | "network.connect"
  | "credential.read"
  | "agent.spawn";

export type UnknownToolPolicy = "deny" | "allow";

export interface SandboxConfig {
  level?: SandboxLevel;
  unknownTools?: UnknownToolPolicy;
  network?: { allowedDomains?: string[]; deniedDomains?: string[] };
  filesystem?: {
    allowRead?: string[];
    denyRead?: string[];
    allowWrite?: string[];
    denyWrite?: string[];
  };
}

export interface PolicyRequest {
  toolName: string;
  readPaths?: readonly string[];
  writePaths?: readonly string[];
  cwd: string;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface PolicyEngine {
  check(request: PolicyRequest): PolicyDecision;
  describe(): EffectiveSandboxPolicy;
}

export interface EffectiveSandboxPolicy {
  level: SandboxLevel;
  unknownTools: UnknownToolPolicy;
  workspace: string;
  allowRead: readonly string[];
  denyRead: readonly string[];
  allowWrite: readonly string[];
  denyWrite: readonly string[];
  allowedDomains: readonly string[];
  deniedDomains: readonly string[];
}
