import {
  SandboxManager,
  VENDORED_SRT_WIN_EXE,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import type { EffectiveSandboxPolicy } from "../types.ts";

function toRuntimeConfig(policy: EffectiveSandboxPolicy): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: [...policy.allowedDomains],
      deniedDomains: [...policy.deniedDomains],
    },
    filesystem: {
      // Windows runtime 0.0.76 applies session grants with recursive ACL
      // propagation; this can block for 60s on large workspaces. Grants are
      // supplied at exec time instead.
      allowRead: [...policy.allowRead],
      // Windows deny ACLs are applied per exec by sandbox-runtime. Applying
      // them during session initialization triggers the old recursive stamp
      // path and blocks startup on profile-managed directories.
      denyRead: [...policy.denyRead],
      allowWrite: [...policy.allowWrite],
      denyWrite: [...policy.denyWrite],
    },
    // Windows requires an explicit srt-win path; resolveSrtWin has no
    // implicit fallback (a discovered binary could sit inside the sandbox
    // write grant and be replaced by sandboxed code).
    ...(process.platform === "win32"
      ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } }
      : {}),
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
