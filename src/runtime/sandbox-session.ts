import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import type { EffectiveSandboxPolicy } from "../types.js";

function toRuntimeConfig(policy: EffectiveSandboxPolicy): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: [...policy.allowedDomains],
      deniedDomains: [...policy.deniedDomains],
    },
    filesystem: {
      allowRead: [...policy.allowRead],
      denyRead: [...policy.denyRead],
      allowWrite: [...policy.allowWrite],
      denyWrite: [...policy.denyWrite],
    },
  };
}

export class SandboxSession {
  private initialized = false;
  constructor(private readonly policy: EffectiveSandboxPolicy) {}
  async start(): Promise<void> {
    if (this.policy.level === "yolo" || this.initialized) return;
    await SandboxManager.initialize(toRuntimeConfig(this.policy));
    this.initialized = true;
  }
  async stop(): Promise<void> {
    if (this.initialized) {
      await SandboxManager.reset();
      this.initialized = false;
    }
  }
  get isActive(): boolean {
    return this.initialized;
  }
}
