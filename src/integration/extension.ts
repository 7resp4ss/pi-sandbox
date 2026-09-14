import {
  createBashTool,
  createPowerShellTool,
  type BashOperations,
  type ExtensionAPI,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { getSandboxCapabilityRegistry } from "../capabilities/declaration-api.ts";
import { registerBuiltinCapabilities } from "../capabilities/builtin-capabilities.ts";
import { loadConfig } from "../config/config-loader.ts";
import {
  normalizeSandboxLevel,
  resolveSessionLevel,
  SANDBOX_LEVEL_ENV,
  strictestLevel,
} from "../policy/levels.ts";
import { executeSandboxedProcess } from "../runtime/process-executor.ts";
import { SandboxController } from "../runtime/sandbox-controller.ts";
import type { EffectiveSandboxPolicy, SandboxLevel } from "../types.ts";
import { checkToolCall } from "./tool-call-gate.ts";

let executionCounter = 0;

/** Footer status: dim label + level colored by severity (r green, w yellow, yolo red). */
function formatSandboxStatus(theme: Theme, level: SandboxLevel): string {
  const levelColor: ThemeColor =
    level === "r" ? "success" : level === "w" ? "warning" : "error";
  return `${theme.fg("dim", "Sandbox:")} ${theme.fg(levelColor, level)}`;
}

function createSandboxOperations(shell: string, policy: () => EffectiveSandboxPolicy | undefined): BashOperations {
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
        policy: policy(),
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

  const controller = new SandboxController(registry);
  /**
   * Level inherited through PI_SANDBOX_LEVEL at session start, if any.
   * Runtime switches may move within it but never above it, mirroring the
   * rule that delegation can only tighten a session's sandbox.
   */
  let inheritedCeiling: SandboxLevel | undefined;

  // Single source of truth for whether shell tools run in the OS sandbox.
  // In yolo mode the session never activates, so this one check covers it.
  const useSandbox = () => controller.isSandboxActive;

  pi.registerTool({
    ...originalBash,
    label: "bash (sandboxed)",
    execute: (id, params, signal, onUpdate, ctx) =>
      useSandbox()
        ? createBashTool(ctx.cwd, {
            operations: createSandboxOperations("bash", () => controller.policyEngine?.describe()),
          }).execute(id, params, signal, onUpdate)
        : originalBash.execute(id, params, signal, onUpdate),
  });
  pi.registerTool({
    ...originalPowerShell,
    label: "powershell (sandboxed)",
    execute: (id, params, signal, onUpdate, ctx) =>
      useSandbox()
        ? createPowerShellTool(ctx.cwd, {
            operations: createSandboxOperations("powershell", () => controller.policyEngine?.describe()),
          }).execute(id, params, signal, onUpdate)
        : originalPowerShell.execute(id, params, signal, onUpdate),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!controller.policyEngine) return undefined;
    return checkToolCall(controller.policyEngine, registry, event, ctx.cwd);
  });

  pi.on("user_bash", () =>
    useSandbox() ? { operations: createSandboxOperations("bash", () => controller.policyEngine?.describe()) } : undefined,
  );

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    for (const [toolName, declaration] of Object.entries(config.tools ?? {})) {
      registry.register({ toolName, capabilities: declaration.capabilities });
    }
    const envLevel = process.env[SANDBOX_LEVEL_ENV]?.trim();
    inheritedCeiling = envLevel ? normalizeSandboxLevel(envLevel) : undefined;
    const level = resolveSessionLevel({
      flag: pi.getFlag("sandbox"),
      configLevel: config.level,
      env: envLevel,
    });
    await controller.switchTo(config, level, ctx.cwd);
    ctx.ui.setStatus("sandbox", formatSandboxStatus(ctx.ui.theme, level));
    if (level === "yolo")
      ctx.ui.notify("sandbox mode is yolo", "warning");
  });

  pi.on("session_shutdown", async () => {
    await controller.shutdown();
  });

  pi.registerCommand("sandbox", {
    description: "Show the sandbox policy or switch level: /sandbox [r|w|yolo]",
    getArgumentCompletions: (prefix) =>
      ["r", "w", "yolo"]
        .filter((level) => level.startsWith(prefix))
        .map((level) => ({
          value: level,
          label: level,
          description:
            level === "r"
              ? "workspace read-only"
              : level === "w"
                ? "workspace writable"
                : "disable sandboxing",
        })),
    handler: async (args, ctx) => {
      if (!controller.policyEngine || controller.currentLevel === undefined) {
        return ctx.ui.notify("Sandbox has not started", "info");
      }
      const arg = args.trim();
      if (!arg) {
        const policy = controller.policyEngine.describe();
        return ctx.ui.notify(
          [
            `Sandbox level: ${policy.level}`,
            `Unknown tools: ${policy.unknownTools}`,
            `Workspace: ${policy.workspace}`,
            "Usage: /sandbox <r|w|yolo>",
          ].join("\n"),
          "info",
        );
      }
      let requested: SandboxLevel;
      try {
        requested = normalizeSandboxLevel(arg);
      } catch (error) {
        return ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
      const next = inheritedCeiling
        ? strictestLevel(requested, inheritedCeiling)
        : requested;
      if (next === controller.currentLevel) {
        return ctx.ui.notify(
          next === requested
            ? `sandbox is already at ${next}`
            : `the inherited PI_SANDBOX_LEVEL ceiling keeps the sandbox at ${next}`,
          "info",
        );
      }
      if (next !== requested) {
        ctx.ui.notify(
          `inherited PI_SANDBOX_LEVEL ceiling clamps ${requested} to ${next}`,
          "warning",
        );
      }
      try {
        await controller.switchTo(loadConfig(ctx.cwd), next, ctx.cwd);
      } catch (error) {
        return ctx.ui.notify(
          `failed to switch sandbox level: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
      ctx.ui.setStatus("sandbox", formatSandboxStatus(ctx.ui.theme, next));
      ctx.ui.notify(`sandbox level switched to ${next}`, "info");
      if (next === "yolo")
        ctx.ui.notify("sandbox mode is yolo", "warning");
    },
  });
}
