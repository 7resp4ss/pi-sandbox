export type SandboxLevel = "r" | "w" | "yolo";

export type SandboxCapability =
  | "filesystem.read"
  | "filesystem.write"
  | "process.execute"
  | "network.connect";

export type UnknownToolPolicy = "deny" | "allow";

/** Declarative counterpart of `declareSandboxTool` for sandbox.json. */
export interface SandboxToolDeclarationConfig {
  capabilities: readonly SandboxCapability[];
}

export interface IsolatedCredentialConfig {
  mode: "deny" | "mask";
  injectHosts?: string[];
}

export interface IsolatedCredentialFileConfig
  extends IsolatedCredentialConfig {
  path: string;
}

export interface IsolatedCredentialEnvConfig extends IsolatedCredentialConfig {
  name: string;
}

export interface IsolatedExtensionConfig {
  entry: string;
  sandbox?: {
    filesystem?: {
      allowRead?: string[];
      denyRead?: string[];
      allowWrite?: string[];
      denyWrite?: string[];
    };
    network?: { allowedDomains?: string[]; deniedDomains?: string[] };
    credentials?: {
      files?: IsolatedCredentialFileConfig[];
      envVars?: IsolatedCredentialEnvConfig[];
    };
  };
  process?: { childProcessApi?: boolean };
  environment?: { allowNonSecret?: string[] };
  limits?: {
    startupMs?: number;
    callMs?: number;
    maxMessageBytes?: number;
  };
}

export interface SandboxConfig {
  level?: SandboxLevel;
  unknownTools?: UnknownToolPolicy;
  /** Tool capability declarations; config can extend but not remove builtins. */
  tools?: Record<string, SandboxToolDeclarationConfig>;
  /** Untrusted extensions. Accepted only in the global sandbox config. */
  isolatedExtensions?: Record<string, IsolatedExtensionConfig>;
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
