import type { SandboxLevel } from "../types.js";

/**
 * Environment variable every session exports its effective sandbox level to.
 * Sessions created later in the same process (in-process subagent children)
 * and spawned runner processes inherit it as a ceiling: their own level is
 * the strictest of what they resolve themselves and this value, so a level
 * can never widen through delegation.
 */
export const SANDBOX_LEVEL_ENV = "PI_SANDBOX_LEVEL";

const STRICTNESS: Record<SandboxLevel, number> = { yolo: 0, w: 1, r: 2 };

/** The more restrictive of two levels. */
export function strictestLevel(a: SandboxLevel, b: SandboxLevel): SandboxLevel {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export interface SessionLevelSources {
  /** CLI flag value; undefined (or blank) when the flag was not provided. */
  flag?: unknown;
  /** `level` from sandbox.json; undefined (or blank) when absent. */
  configLevel?: unknown;
  /** Inherited ceiling from the parent session's exported level. */
  env?: string | undefined;
}

function provided(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Resolve the level one session runs at: the explicit CLI flag wins over the
 * config file, both fall back to "w", and an inherited environment ceiling
 * can only tighten the result, never widen it. Invalid values throw, matching
 * the fail-closed behavior of an invalid flag.
 */
export function resolveSessionLevel(sources: SessionLevelSources): SandboxLevel {
  const own = provided(sources.flag)
    ? normalizeSandboxLevel(sources.flag)
    : provided(sources.configLevel)
      ? normalizeSandboxLevel(sources.configLevel)
      : "w";
  return provided(sources.env)
    ? strictestLevel(own, normalizeSandboxLevel(sources.env))
    : own;
}

export function normalizeSandboxLevel(value: unknown): SandboxLevel {
  switch (value) {
    case undefined:
    case "w":
    case "write":
      return "w";
    case "r":
    case "read":
    case "readonly":
      return "r";
    case "yolo":
      return "yolo";
    default:
      throw new Error(
        `Invalid sandbox level "${String(value)}"; expected r, w, or yolo.`,
      );
  }
}
