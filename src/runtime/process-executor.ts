import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import {
  SandboxManager,
  grantWindowsAcl,
  revokeWindowsAcl,
  restoreWindowsAcl,
  getWindowsSandboxUserStatus,
  resolveSrtWin,
  VENDORED_SRT_WIN_EXE,
} from "@anthropic-ai/sandbox-runtime";
import type { EffectiveSandboxPolicy } from "../types.ts";
import { expandWindowsFsGlobs } from "./windows-glob-expand.ts";

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
  const denyRead = options.policy && process.platform === "win32"
    ? expandWindowsFsGlobs(options.policy.denyRead, options.cwd, homedir())
    : options.policy?.denyRead;
  const denyWrite = options.policy && process.platform === "win32"
    ? expandWindowsFsGlobs(options.policy.denyWrite, options.cwd, homedir())
    : options.policy?.denyWrite;
  const wrapped = await SandboxManager.wrapWithSandboxArgv(
    options.command,
    options.shell,
    options.policy ? {
      filesystem: {
        allowWrite: [],
        denyRead: [...(denyRead ?? [])],
        denyWrite: [...(denyWrite ?? [])],
      },
    } : undefined,
    options.signal,
    options.cwd,
    { commandId: options.commandId, commandText: options.command },
  );
  const windows = process.platform === "win32" && options.policy
    ? (() => {
        const srtWin = resolveSrtWin({ path: VENDORED_SRT_WIN_EXE });
        return { status: getWindowsSandboxUserStatus({ srtWin }), srtWin };
      })()
    : undefined;
  let windowsAclGranted = false;
  if (windows?.status.sid && options.policy) {
    try {
      grantWindowsAcl({
        sandboxUserSid: windows.status.sid,
        holderPid: process.pid,
        read: options.policy.allowRead,
        write: options.policy.allowWrite,
        srtWin: windows.srtWin,
      });
      windowsAclGranted = true;
    } catch (error) {
      revokeWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
      restoreWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
      throw error;
    }
  }


  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
        cwd: options.cwd,
        env: wrapped.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (windowsAclGranted && windows?.status.sid) {
        revokeWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
        restoreWindowsAcl({ sandboxUserSid: windows.status.sid, holderPid: process.pid, srtWin: windows.srtWin });
      }
      reject(error);
      return;
    }
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
      if (windowsAclGranted && windows?.status.sid) {
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
