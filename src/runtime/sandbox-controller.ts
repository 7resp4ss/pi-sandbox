import type { CapabilityRegistry } from "../capabilities/capability-registry.ts";
import { buildEffectivePolicy } from "../policy/policy-builder.ts";
import { createPolicyEngine } from "../policy/policy-engine.ts";
import type { EffectiveSandboxPolicy, PolicyEngine, SandboxConfig, SandboxLevel } from "../types.ts";
import { SandboxSession } from "./sandbox-session.ts";
import { SANDBOX_LEVEL_ENV } from "../policy/levels.ts";

/** Owns the process-wide runtime and keeps policy/runtime transitions atomic. */
export class SandboxController {
  private session?: SandboxSession;
  private engine?: PolicyEngine;
  private level?: SandboxLevel;
  private closed = false;
  private transition: Promise<void> = Promise.resolve();

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly createSession: (policy: EffectiveSandboxPolicy) => SandboxSession = (policy) => new SandboxSession(policy),
  ) {}

  get currentLevel(): SandboxLevel | undefined { return this.level; }
  get policyEngine(): PolicyEngine | undefined { return this.engine; }
  get isSandboxActive(): boolean { return this.session?.isActive === true; }

  switchTo(config: SandboxConfig, level: SandboxLevel, cwd: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("sandbox controller is shut down"));
    const operation = this.transition.then(() => this.performSwitch(config, level, cwd));
    this.transition = operation.catch(() => undefined);
    return operation;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.transition;
    await this.session?.stop();
    this.session = undefined;
    this.engine = undefined;
    this.level = undefined;
  }

  private async performSwitch(config: SandboxConfig, level: SandboxLevel, cwd: string): Promise<void> {
    const policy = buildEffectivePolicy({ ...config, level }, cwd);
    const previous = this.session;
    await previous?.stop();
    const next = this.createSession(policy);
    try {
      await next.start();
    } catch (error) {
      try { await previous?.start(); }
      catch { this.session = undefined; this.engine = undefined; this.level = undefined; }
      throw error;
    }
    this.session = next;
    this.engine = createPolicyEngine(policy, this.registry);
    this.level = level;
    process.env[SANDBOX_LEVEL_ENV] = level;
  }
}
