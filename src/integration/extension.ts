import {
  createBashTool,
  createPowerShellTool,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getSandboxCapabilityRegistry } from "../capabilities/declaration-api.js";
import { registerBuiltinCapabilities } from "../capabilities/builtin-capabilities.js";
import { loadConfig } from "../config/config-loader.js";
import { resolveSessionLevel, SANDBOX_LEVEL_ENV } from "../policy/levels.js";
import { buildEffectivePolicy } from "../policy/policy-builder.js";
import { createPolicyEngine } from "../policy/policy-engine.js";
import { executeSandboxedProcess } from "../runtime/process-executor.js";
import { SandboxSession } from "../runtime/sandbox-session.js";
import type { PolicyEngine } from "../types.js";
import { checkToolCall } from "./tool-call-gate.js";

let executionCounter = 0;

function createSandboxOperations(shell: string): BashOperations {
  return {
    exec: (command, cwd, options) => {
      executionCounter += 1;
      return executeSandboxedProcess({
        command,
        cwd,
        shell,
        signal: options.signal,
        timeoutMs: options.timeout ? options.timeout * 1000 : undefined,
        commandId: `${shell}:${executionCounter}`,
        onData: options.onData,
      });
    },
  };
}

export default function registerPiSandbox(pi: ExtensionAPI): void {
  const registry = getSandboxCapabilityRegistry();
  registerBuiltinCapabilities(registry);

  pi.registerFlag("sandbox", {
    description:
      "Sandbox level: r, w, or yolo (default w; sandbox.json may set level)",
    type: "string",
  });

  const originalCwd = process.cwd();
  const originalBash = createBashTool(originalCwd);
  const originalPowerShell = createPowerShellTool(originalCwd);

  let session: SandboxSession | undefined;
  let engine: PolicyEngine | undefined;

  // Single source of truth for whether shell tools run in the OS sandbox.
  // In yolo mode the session never activates, so this one check covers it.
  const useSandbox = () => session?.isActive === true;

  pi.registerTool({
    ...originalBash,
    label: "bash (sandboxed)",
    execute: (id, params, signal, onUpdate, ctx) =>
      useSandbox()
        ? createBashTool(ctx.cwd, {
            operations: createSandboxOperations("bash"),
          }).execute(id, params, signal, onUpdate)
        : originalBash.execute(id, params, signal, onUpdate),
  });
  pi.registerTool({
    ...originalPowerShell,
    label: "powershell (sandboxed)",
    execute: (id, params, signal, onUpdate, ctx) =>
      useSandbox()
        ? createPowerShellTool(ctx.cwd, {
            operations: createSandboxOperations("powershell"),
          }).execute(id, params, signal, onUpdate)
        : originalPowerShell.execute(id, params, signal, onUpdate),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!engine) return undefined;
    return checkToolCall(engine, registry, event, ctx.cwd);
  });

  pi.on("user_bash", () =>
    useSandbox() ? { operations: createSandboxOperations("bash") } : undefined,
  );

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    for (const [toolName, declaration] of Object.entries(config.tools ?? {})) {
      registry.register({ toolName, capabilities: declaration.capabilities });
    }
    const level = resolveSessionLevel({
      flag: pi.getFlag("sandbox"),
      configLevel: config.level,
      env: process.env[SANDBOX_LEVEL_ENV],
    });
    const policy = buildEffectivePolicy({ ...config, level }, ctx.cwd);
    const nextSession = new SandboxSession(policy);
    await nextSession.start();

    // Publish the new state only after runtime initialization succeeds. This
    // prevents a failed startup from leaving policy checks active while shell
    // tools have already fallen back to the unsandboxed implementation.
    session = nextSession;
    engine = createPolicyEngine(policy, registry);
    // Export the level so sessions this one delegates to (in-process children
    // and spawned runners) inherit it as a ceiling that can only tighten.
    process.env[SANDBOX_LEVEL_ENV] = level;
    ctx.ui.setStatus("sandbox", `Sandbox: ${level}`);
    if (level === "yolo")
      ctx.ui.notify("WARNING: sandbox mode is yolo.", "warning");
  });

  pi.on("session_shutdown", async () => {
    await session?.stop();
    session = undefined;
    engine = undefined;
  });

  pi.registerCommand("sandbox", {
    description: "Show sandbox policy",
    handler: async (_args, ctx) => {
      if (!engine) return ctx.ui.notify("Sandbox has not started", "info");
      const policy = engine.describe();
      ctx.ui.notify(
        [
          `Sandbox level: ${policy.level}`,
          `Unknown tools: ${policy.unknownTools}`,
          `Workspace: ${policy.workspace}`,
        ].join("\n"),
        "info",
      );
    },
  });
}
