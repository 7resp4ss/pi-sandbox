import type { SandboxLevel } from "../types.js";

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
