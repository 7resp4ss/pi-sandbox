import { resolve } from "node:path";
import type { EffectiveSandboxPolicy, SandboxConfig } from "../types.ts";
import { normalizeSandboxLevel } from "./levels.ts";

const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
const DEFAULT_NETWORK = [
  "github.com",
  "*.github.com",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
  "pypi.org",
  "*.pypi.org",
];

export function buildEffectivePolicy(
  config: SandboxConfig,
  workspace: string,
): EffectiveSandboxPolicy {
  const level = normalizeSandboxLevel(config.level);
  const root = resolve(workspace);
  if (level === "yolo") {
    return {
      level,
      unknownTools: "allow",
      workspace: root,
      allowRead: [],
      denyRead: [],
      allowWrite: [],
      denyWrite: [],
      allowedDomains: [],
      deniedDomains: [],
    };
  }

  const fs = config.filesystem ?? {};
  const readOnly = level === "r";
  return {
    level,
    unknownTools: config.unknownTools ?? "deny",
    workspace: root,
    allowRead: [root, ...(fs.allowRead ?? [])],
    denyRead: [...DEFAULT_DENY_READ, ...(fs.denyRead ?? [])],
    allowWrite: readOnly ? ["/tmp"] : [root, "/tmp", ...(fs.allowWrite ?? [])],
    denyWrite: [
      ...(readOnly
        ? [root]
        : [".env", ".env.*", "*.pem", "*.key", ".git/config"]),
      ...(fs.denyWrite ?? []),
    ],
    allowedDomains: readOnly
      ? []
      : [...DEFAULT_NETWORK, ...(config.network?.allowedDomains ?? [])],
    deniedDomains: config.network?.deniedDomains ?? [],
  };
}
