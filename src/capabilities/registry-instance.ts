import type { CapabilityRegistry } from "./capability-registry.js";
import { createCapabilityRegistry } from "./capability-registry.js";

const key = Symbol.for("pi-sandbox.capability-registry");
const state = globalThis as typeof globalThis & { [key]?: CapabilityRegistry };

// Extensions can be loaded from separate package instances. A global registry
// keeps capability declarations visible regardless of load order or deduping.
export function getSharedCapabilityRegistry(): CapabilityRegistry {
  return (state[key] ??= createCapabilityRegistry());
}
