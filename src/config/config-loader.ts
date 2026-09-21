import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SandboxCapability,
  SandboxConfig,
  SandboxToolDeclarationConfig,
} from "../types.ts";
import { validateIsolatedExtensions } from "../isolated/config.ts";

const VALID_CAPABILITIES: readonly SandboxCapability[] = [
  "filesystem.read",
  "filesystem.write",
  "process.execute",
  "network.connect",
];

/** Validate the `tools` section of a config file; undefined when absent. */
export function validateToolDeclarations(
  value: unknown,
  label: string,
): Record<string, SandboxToolDeclarationConfig> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `${label} must be an object mapping tool names to { "capabilities": [...] }`,
    );
  }
  const result: Record<string, SandboxToolDeclarationConfig> = {};
  for (const [toolName, declaration] of Object.entries(value)) {
    if (!toolName.trim()) {
      throw new Error(`${label} contains an empty tool name.`);
    }
    if (
      !declaration ||
      typeof declaration !== "object" ||
      Array.isArray(declaration)
    ) {
      throw new Error(
        `${label}.${toolName} must be an object with a "capabilities" array.`,
      );
    }
    const unknownFields = Object.keys(declaration).filter(
      (field) => field !== "capabilities",
    );
    if (unknownFields.length) {
      throw new Error(
        `${label}.${toolName} has unsupported fields: ${unknownFields.join(", ")}.`,
      );
    }
    const capabilities = (declaration as { capabilities?: unknown })
      .capabilities;
    if (!Array.isArray(capabilities)) {
      throw new Error(`${label}.${toolName}.capabilities must be an array.`);
    }
    for (const capability of capabilities) {
      if (
        typeof capability !== "string" ||
        !VALID_CAPABILITIES.includes(capability as SandboxCapability)
      ) {
        throw new Error(
          `${label}.${toolName}.capabilities contains invalid capability "${String(capability)}"; expected one of: ${VALID_CAPABILITIES.join(", ")}.`,
        );
      }
    }
    result[toolName] = {
      capabilities: [...capabilities] as SandboxCapability[],
    };
  }
  return Object.keys(result).length ? result : undefined;
}

/** Resolve the directory used by pi for agent data and extensions. */
export function getAgentDir(home = homedir()): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
}

function readConfigFile(path: string, allowIsolatedExtensions: boolean): SandboxConfig {
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

  const config = value as SandboxConfig;
  config.tools = validateToolDeclarations(config.tools, `tools in ${path}`);
  if (!allowIsolatedExtensions && config.isolatedExtensions !== undefined) {
    throw new Error(`isolatedExtensions is only allowed in the global sandbox config: ${path}`);
  }
  config.isolatedExtensions = validateIsolatedExtensions(
    config.isolatedExtensions,
    `isolatedExtensions in ${path}`,
  );
  return config;
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
    tools:
      global.tools || project.tools
        ? { ...global.tools, ...project.tools }
        : undefined,
    isolatedExtensions: global.isolatedExtensions,
  };
}

export function loadConfig(cwd: string, home = homedir()): SandboxConfig {
  const global = readConfigFile(
    join(getAgentDir(home), "extensions", "sandbox.json"),
    true,
  );
  const project = readConfigFile(join(cwd, ".pi", "sandbox.json"), false);
  return mergeConfigs(global, project);
}
