import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SandboxConfig } from "../types.js";

/** Resolve the directory used by pi for agent data and extensions. */
export function getAgentDir(home = homedir()): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
}

function readConfigFile(path: string): SandboxConfig {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in sandbox config: ${path}`, {
      cause: error,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid sandbox config: ${path}`);
  }

  return value as SandboxConfig;
}

function mergeConfigs(
  global: SandboxConfig,
  project: SandboxConfig,
): SandboxConfig {
  return {
    ...global,
    ...project,
    network: { ...global.network, ...project.network },
    filesystem: { ...global.filesystem, ...project.filesystem },
  };
}

export function loadConfig(cwd: string, home = homedir()): SandboxConfig {
  const global = readConfigFile(
    join(getAgentDir(home), "extensions", "sandbox.json"),
  );
  const project = readConfigFile(join(cwd, ".pi", "sandbox.json"));
  return mergeConfigs(global, project);
}
