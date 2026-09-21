import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  CredentialsConfigSchema,
  FilesystemConfigSchema,
  NetworkConfigSchema,
  SandboxRuntimeConfigSchema,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import type {
  IsolatedCredentialEnvConfig,
  IsolatedCredentialFileConfig,
  IsolatedExtensionConfig,
} from "../types.ts";

export interface ResolvedIsolatedExtension {
  entry: string;
  runtimeConfig: SandboxRuntimeConfig;
  readPaths: string[];
  writePaths: string[];
  childProcessApi: boolean;
  environment: NodeJS.ProcessEnv;
  limits: { startupMs: number; callMs: number; maxMessageBytes: number };
}

const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key", ".git/config"];
const BASE_ENV = ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP"];

function privateReadRoots(): string[] {
  return process.platform === "darwin"
    ? ["/Users", "/Volumes", "/tmp", "/private/tmp", tmpdir()]
    : ["/home", "/root", "/tmp", "/var/tmp", "/mnt", "/media", tmpdir()];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} has unsupported fields: ${unknown.join(", ")}.`);
}

function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return [...value];
}

function positiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}

function credentials<T extends "files" | "envVars">(
  value: unknown,
  kind: T,
  label: string,
): T extends "files" ? IsolatedCredentialFileConfig[] : IsolatedCredentialEnvConfig[] {
  if (value === undefined) return [] as never;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => {
    const entry = record(item, `${label}[${index}]`);
    const identity = kind === "files" ? "path" : "name";
    fields(entry, [identity, "mode", "injectHosts"], `${label}[${index}]`);
    if (typeof entry[identity] !== "string" || !entry[identity].trim()) {
      throw new Error(`${label}[${index}].${identity} must be a non-empty string.`);
    }
    if (entry.mode !== "deny" && entry.mode !== "mask") {
      throw new Error(`${label}[${index}].mode must be "deny" or "mask".`);
    }
    return {
      [identity]: entry[identity],
      mode: entry.mode,
      injectHosts: strings(entry.injectHosts, `${label}[${index}].injectHosts`),
    };
  }) as never;
}

export function validateIsolatedExtensions(
  value: unknown,
  label: string,
): Record<string, IsolatedExtensionConfig> | undefined {
  if (value === undefined) return undefined;
  const extensions = record(value, label);
  const result: Record<string, IsolatedExtensionConfig> = {};
  for (const [name, raw] of Object.entries(extensions)) {
    if (!name.trim()) throw new Error(`${label} contains an empty extension name.`);
    const extension = record(raw, `${label}.${name}`);
    fields(extension, ["entry", "sandbox", "process", "environment", "limits"], `${label}.${name}`);
    if (typeof extension.entry !== "string" || !extension.entry.trim()) {
      throw new Error(`${label}.${name}.entry must be a non-empty string.`);
    }

    const sandbox = extension.sandbox === undefined ? {} : record(extension.sandbox, `${label}.${name}.sandbox`);
    fields(sandbox, ["filesystem", "network", "credentials"], `${label}.${name}.sandbox`);
    const filesystem = sandbox.filesystem === undefined ? {} : record(sandbox.filesystem, `${label}.${name}.sandbox.filesystem`);
    fields(filesystem, ["allowRead", "denyRead", "allowWrite", "denyWrite"], `${label}.${name}.sandbox.filesystem`);
    const network = sandbox.network === undefined ? {} : record(sandbox.network, `${label}.${name}.sandbox.network`);
    fields(network, ["allowedDomains", "deniedDomains"], `${label}.${name}.sandbox.network`);
    const credentialConfig = sandbox.credentials === undefined ? {} : record(sandbox.credentials, `${label}.${name}.sandbox.credentials`);
    fields(credentialConfig, ["files", "envVars"], `${label}.${name}.sandbox.credentials`);

    const processConfig = extension.process === undefined ? {} : record(extension.process, `${label}.${name}.process`);
    fields(processConfig, ["childProcessApi"], `${label}.${name}.process`);
    if (processConfig.childProcessApi !== undefined && typeof processConfig.childProcessApi !== "boolean") {
      throw new Error(`${label}.${name}.process.childProcessApi must be a boolean.`);
    }
    const environment = extension.environment === undefined ? {} : record(extension.environment, `${label}.${name}.environment`);
    fields(environment, ["allowNonSecret"], `${label}.${name}.environment`);
    const limits = extension.limits === undefined ? {} : record(extension.limits, `${label}.${name}.limits`);
    fields(limits, ["startupMs", "callMs", "maxMessageBytes"], `${label}.${name}.limits`);

    result[name] = {
      entry: extension.entry,
      sandbox: {
        filesystem: {
          allowRead: strings(filesystem.allowRead, `${label}.${name}.sandbox.filesystem.allowRead`),
          denyRead: strings(filesystem.denyRead, `${label}.${name}.sandbox.filesystem.denyRead`),
          allowWrite: strings(filesystem.allowWrite, `${label}.${name}.sandbox.filesystem.allowWrite`),
          denyWrite: strings(filesystem.denyWrite, `${label}.${name}.sandbox.filesystem.denyWrite`),
        },
        network: {
          allowedDomains: strings(network.allowedDomains, `${label}.${name}.sandbox.network.allowedDomains`),
          deniedDomains: strings(network.deniedDomains, `${label}.${name}.sandbox.network.deniedDomains`),
        },
        credentials: {
          files: credentials(credentialConfig.files, "files", `${label}.${name}.sandbox.credentials.files`),
          envVars: credentials(credentialConfig.envVars, "envVars", `${label}.${name}.sandbox.credentials.envVars`),
        },
      },
      process: { childProcessApi: processConfig.childProcessApi as boolean | undefined },
      environment: { allowNonSecret: strings(environment.allowNonSecret, `${label}.${name}.environment.allowNonSecret`) },
      limits: {
        startupMs: positiveInteger(limits.startupMs, `${label}.${name}.limits.startupMs`),
        callMs: positiveInteger(limits.callMs, `${label}.${name}.limits.callMs`),
        maxMessageBytes: positiveInteger(limits.maxMessageBytes, `${label}.${name}.limits.maxMessageBytes`),
      },
    };
  }
  return Object.keys(result).length ? result : undefined;
}

function expandPath(path: string, workspace: string, extensionRoot: string): string {
  const substitute = (token: string, root: string): string | undefined =>
    path === token ? root : path.startsWith(`${token}/`) ? join(root, path.slice(token.length + 1)) : undefined;
  return substitute("$workspace", workspace) ?? substitute("$extension", extensionRoot) ??
    (path.startsWith("~") ? `${homedir()}${path.slice(1)}` : isAbsolute(path) ? path : resolve(workspace, path));
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

export function buildExtensionRuntimeConfig(options: {
  config: IsolatedExtensionConfig;
  workspace: string;
  runtimeReadPaths: readonly string[];
}): ResolvedIsolatedExtension {
  const rawEntry = options.config.entry.startsWith("~")
    ? `${homedir()}${options.config.entry.slice(1)}`
    : options.config.entry;
  if (!isAbsolute(rawEntry)) throw new Error(`isolated extension entry must be absolute: ${options.config.entry}`);
  const entry = resolve(rawEntry);
  const workspace = resolve(options.workspace);
  const extensionRoot = dirname(entry);
  const fs = options.config.sandbox?.filesystem;
  const resolvePaths = (paths: readonly string[] | undefined) =>
    (paths ?? []).map((path) => expandPath(path, workspace, extensionRoot));
  const readPaths = unique([extensionRoot, ...options.runtimeReadPaths, ...resolvePaths(fs?.allowRead)]);
  const writePaths = unique(resolvePaths(fs?.allowWrite));
  const credentialFiles = (options.config.sandbox?.credentials?.files ?? []).map((item) => ({
    ...item,
    path: expandPath(item.path, workspace, extensionRoot),
  }));
  const credentialEnv = options.config.sandbox?.credentials?.envVars ?? [];
  const nonSecretEnvironment = options.config.environment?.allowNonSecret ?? [];
  const duplicateCredential = credentialEnv.find((item) => nonSecretEnvironment.includes(item.name));
  if (duplicateCredential) {
    throw new Error(
      `credential environment variable ${duplicateCredential.name} cannot also be allowed as non-secret`,
    );
  }
  const hasMaskedCredentials = [...credentialFiles, ...credentialEnv].some((item) => item.mode === "mask");

  const network = NetworkConfigSchema.parse({
    allowedDomains: options.config.sandbox?.network?.allowedDomains ?? [],
    deniedDomains: options.config.sandbox?.network?.deniedDomains ?? [],
    strictAllowlist: true,
    allowAllUnixSockets: false,
    allowLocalBinding: false,
  });
  if (hasMaskedCredentials) network.tlsTerminate = {};
  const filesystem = FilesystemConfigSchema.parse({
    disabled: false,
    allowRead: readPaths,
    denyRead: [...privateReadRoots(), ...DEFAULT_DENY_READ, ...resolvePaths(fs?.denyRead)],
    allowWrite: writePaths,
    denyWrite: [...DEFAULT_DENY_WRITE, ...resolvePaths(fs?.denyWrite)],
    allowGitConfig: false,
  });
  const credentialConfig = credentialFiles.length || credentialEnv.length
    ? CredentialsConfigSchema.parse({ files: credentialFiles, envVars: credentialEnv, allowPlaintextInject: false })
    : undefined;
  const runtimeConfig = SandboxRuntimeConfigSchema.parse({
    network,
    filesystem,
    credentials: credentialConfig,
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
    allowPty: false,
  });

  const environment: NodeJS.ProcessEnv = {};
  for (const name of [...BASE_ENV, ...nonSecretEnvironment, ...credentialEnv.map((item) => item.name)]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return {
    entry,
    runtimeConfig,
    readPaths,
    writePaths,
    childProcessApi: options.config.process?.childProcessApi ?? false,
    environment,
    limits: {
      startupMs: options.config.limits?.startupMs ?? 5_000,
      callMs: options.config.limits?.callMs ?? 120_000,
      maxMessageBytes: options.config.limits?.maxMessageBytes ?? 1_048_576,
    },
  };
}
