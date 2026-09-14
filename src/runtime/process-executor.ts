import { spawn, type ChildProcess } from "node:child_process";
import { SandboxManager, grantWindowsAcl, revokeWindowsAcl, restoreWindowsAcl, getWindowsSandboxUserStatus, resolveSrtWin, VENDORED_SRT_WIN_EXE } from "@anthropic-ai/sandbox-runtime";
import type { EffectiveSandboxPolicy } from "../types.ts";

export interface ProcessOptions {
  command: string;
  cwd: string;
  shell?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  commandId: string;
  onData?: (data: Buffer) => void;
  policy?: EffectiveSandboxPolicy;
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing the direct child when the process group is gone.
    }
  }
  child.kill("SIGKILL");
}

export async function executeSandboxedProcess(
  options: ProcessOptions,
): Promise<{ exitCode: number | null }> {
  // The runtime returns a complete argv so the caller never needs a second
  // shell parse. This matters for both quoting and cross-platform use.
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    options.command,
    options.shell,
    options.policy ? {
      filesystem: {
        denyRead: [...options.policy.denyRead],
        denyWrite: [...options.policy.denyWrite],
      },
    } : undefined,
    options.signal,
    options.cwd,
    { commandId: options.commandId, commandText: options.command },
  );
  const windows = process.platform === "win32" && options.policy
    ? { status: getWindowsSandboxUserStatus({ srtWin: resolveSrtWin({ path: VENDORED_SRT_WIN_EXE }) }), srtWin: resolveSrtWin({ path: VENDORED_SRT_WIN_EXE }) }
    : undefined;
  if (windows?.status.sid && options.policy) {
    grantWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, read: options.policy.allowRead, write: options.policy.allowWrite, srtWin: windows.srtWin });
  }


  return new Promise((resolve, reject) => {
    const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: options.cwd,
      env: wrapped.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (options.onData) {
      child.stdout?.on("data", options.onData);
      child.stderr?.on("data", options.onData);
    }
    let timer: NodeJS.Timeout | undefined;
    const terminate = () => killProcessTree(child);
    if (options.timeoutMs) timer = setTimeout(terminate, options.timeoutMs);
    const onAbort = () => terminate();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      if (windows?.status.sid) {
        revokeWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
        restoreWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
      }
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode) => {
      cleanup();
      resolve({ exitCode });
    });
  });
}
