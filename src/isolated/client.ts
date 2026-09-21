import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedIsolatedExtension } from "./config.ts";
import type {
  HostMessage,
  SerializedTool,
  WorkerMessage,
} from "./protocol.ts";

interface PendingCall {
  resolve: (result: AgentToolResult<unknown>) => void;
  reject: (error: Error) => void;
  onUpdate?: AgentToolUpdateCallback<unknown>;
  timer: NodeJS.Timeout;
  abort?: () => void;
  signal?: AbortSignal;
}

const require = createRequire(import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateTool(value: unknown): SerializedTool {
  if (!isRecord(value)) throw new Error("worker returned an invalid tool definition");
  for (const field of ["name", "label", "description"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`worker tool ${field} must be a non-empty string`);
    }
  }
  if (!isRecord(value.parameters)) {
    throw new Error(`worker tool ${value.name} has an invalid parameter schema`);
  }
  if (value.promptSnippet !== undefined && typeof value.promptSnippet !== "string") {
    throw new Error(`worker tool ${value.name} has an invalid promptSnippet`);
  }
  if (
    value.promptGuidelines !== undefined &&
    (!Array.isArray(value.promptGuidelines) || value.promptGuidelines.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`worker tool ${value.name} has invalid promptGuidelines`);
  }
  if (value.executionMode !== undefined && value.executionMode !== "parallel" && value.executionMode !== "sequential") {
    throw new Error(`worker tool ${value.name} has an invalid executionMode`);
  }
  if (value.renderShell !== undefined && value.renderShell !== "default" && value.renderShell !== "self") {
    throw new Error(`worker tool ${value.name} has an invalid renderShell`);
  }
  if (value.constrainedSampling !== undefined && value.constrainedSampling !== false) {
    if (!isRecord(value.constrainedSampling)) {
      throw new Error(`worker tool ${value.name} has invalid constrainedSampling`);
    }
    const validJsonSchema =
      value.constrainedSampling.type === "json_schema" &&
      (value.constrainedSampling.strict === "prefer" ||
        value.constrainedSampling.strict === "require");
    const validGrammar =
      value.constrainedSampling.type === "grammar" &&
      isRecord(value.constrainedSampling.variants) &&
      Object.keys(value.constrainedSampling.variants).every(
        (key) => key === "openai_lark" || key === "openai_regex",
      ) &&
      Object.values(value.constrainedSampling.variants).every(
        (item) => typeof item === "string",
      );
    if (!validJsonSchema && !validGrammar) {
      throw new Error(`worker tool ${value.name} has invalid constrainedSampling`);
    }
  }
  return value as unknown as SerializedTool;
}

function validateResult(value: unknown): AgentToolResult<unknown> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error("worker returned an invalid tool result");
  }
  for (const item of value.content) {
    if (
      !isRecord(item) ||
      (item.type === "text" && typeof item.text !== "string") ||
      (item.type === "image" &&
        (typeof item.data !== "string" || typeof item.mimeType !== "string")) ||
      (item.type !== "text" && item.type !== "image")
    ) {
      throw new Error("worker returned invalid tool result content");
    }
  }
  if (value.terminate !== undefined && typeof value.terminate !== "boolean") {
    throw new Error("worker returned an invalid terminate flag");
  }
  return { ...value, details: value.details } as AgentToolResult<unknown>;
}

function parseMessage(line: string): WorkerMessage {
  const value = JSON.parse(line) as unknown;
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("worker returned an invalid message");
  if (value.type === "ready") {
    if (!Array.isArray(value.tools)) throw new Error("worker ready message has no tool list");
    return { type: "ready", tools: value.tools.map(validateTool) };
  }
  if (value.type === "result" || value.type === "update") {
    if (typeof value.callId !== "string") throw new Error("worker result has no call id");
    return { type: value.type, callId: value.callId, result: validateResult(value.result) };
  }
  if (value.type === "error") {
    if (typeof value.message !== "string") throw new Error("worker error has no message");
    return {
      type: "error",
      callId: typeof value.callId === "string" ? value.callId : undefined,
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack : undefined,
    };
  }
  throw new Error(`unknown worker message: ${value.type}`);
}

export class IsolatedExtensionClient {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private stderr = "";
  private ready = false;
  private closed = false;
  private counter = 0;
  private readonly pending = new Map<string, PendingCall>();

  constructor(
    readonly name: string,
    private readonly config: ResolvedIsolatedExtension,
    private readonly onRuntimeFailure?: (error: Error) => void,
  ) {}

  async start(): Promise<SerializedTool[]> {
    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new Error(`isolated extensions are not supported on ${process.platform}`);
    }
    const tempRoot = await mkdtemp(join(tmpdir(), "pi-sandbox-extension-"));
    const settingsPath = join(tempRoot, "settings.json");
    await writeFile(settingsPath, JSON.stringify(this.config.runtimeConfig), { mode: 0o600 });
    try {
      return await this.spawn(settingsPath);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  execute(
    toolName: string,
    toolCallId: string,
    params: unknown,
    cwd: string,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<unknown>,
  ): Promise<AgentToolResult<unknown>> {
    if (!this.child || !this.ready || this.closed) {
      return Promise.reject(new Error(`isolated extension ${this.name} is not running`));
    }
    const callId = `${this.name}:${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finishCall(callId)?.reject(new Error(`isolated extension ${this.name} timed out`));
        this.fail(new Error(`isolated extension ${this.name} exceeded its call timeout`));
      }, this.config.limits.callMs);
      const pending: PendingCall = { resolve, reject, onUpdate, timer, signal };
      this.pending.set(callId, pending);
      if (signal) {
        const abort = () => {
          try {
            this.write({ type: "cancel", callId });
          } catch {
            // The call is rejected below even when the worker has already exited.
          }
          const active = this.finishCall(callId);
          active?.reject(signal.reason instanceof Error ? signal.reason : new Error("isolated tool call aborted"));
        };
        pending.abort = abort;
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
      }
      try {
        this.write({ type: "execute", callId, toolName, toolCallId, params, cwd });
      } catch (error) {
        this.finishCall(callId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    if (!this.closed) {
      this.closed = true;
      try {
        this.write({ type: "shutdown" });
      } catch {
        // The process is already unavailable.
      }
      const error = new Error(`isolated extension ${this.name} stopped`);
      for (const callId of [...this.pending.keys()]) {
        this.finishCall(callId)?.reject(error);
      }
      if (await this.waitForExit(child, 250)) return;
      this.terminate("SIGTERM");
      if (await this.waitForExit(child, 1_000)) return;
    }
    this.terminate("SIGKILL");
    await this.waitForExit(child, 1_000);
  }

  private spawn(settingsPath: string): Promise<SerializedTool[]> {
    const runtimePackage = require.resolve("@anthropic-ai/sandbox-runtime/package.json");
    const srtCli = join(dirname(runtimePackage), "dist", "cli.js");
    const ownPath = fileURLToPath(import.meta.url);
    const workerPath = join(dirname(ownPath), `worker${extname(ownPath)}`);
    const permissions = ["--permission"];
    for (const path of this.config.readPaths) permissions.push(`--allow-fs-read=${path}`);
    for (const path of this.config.writePaths) permissions.push(`--allow-fs-write=${path}`);
    if (this.config.childProcessApi) permissions.push("--allow-child-process");

    this.child = spawn(
      process.execPath,
      [srtCli, "--settings", settingsPath, "--", process.execPath, ...permissions, workerPath, this.config.entry],
      {
        cwd: dirname(this.config.entry),
        env: this.config.environment,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-65_536);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (!this.closed) {
        const detail = this.stderr.trim();
        this.fail(new Error(`isolated extension ${this.name} exited (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`));
      }
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`isolated extension ${this.name} did not start in time`));
        this.fail(new Error(`isolated extension ${this.name} startup timeout`));
      }, this.config.limits.startupMs);
      const onReady = (tools: SerializedTool[]) => {
        clearTimeout(timer);
        resolve(tools);
      };
      const onFailure = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.startup = { onReady, onFailure };
    });
  }

  private startup?: {
    onReady: (tools: SerializedTool[]) => void;
    onFailure: (error: Error) => void;
  };

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.config.limits.maxMessageBytes && this.buffer.indexOf(10) === -1) {
      this.fail(new Error(`isolated extension ${this.name} exceeded the message size limit`));
      return;
    }
    let newline = this.buffer.indexOf(10);
    while (newline !== -1) {
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.length > this.config.limits.maxMessageBytes) {
        this.fail(new Error(`isolated extension ${this.name} exceeded the message size limit`));
        return;
      }
      if (line.length) {
        try {
          this.handle(parseMessage(line.toString("utf8")));
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }
      newline = this.buffer.indexOf(10);
    }
  }

  private handle(message: WorkerMessage): void {
    if (!this.ready) {
      if (message.type === "error" && !message.callId) {
        throw new Error(`isolated extension ${this.name} failed to load: ${message.message}`);
      }
      if (message.type !== "ready") throw new Error(`isolated extension ${this.name} sent data before ready`);
      this.ready = true;
      const startup = this.startup;
      this.startup = undefined;
      startup?.onReady(message.tools);
      return;
    }
    if (message.type === "ready" || (message.type === "error" && !message.callId)) {
      throw new Error(`isolated extension ${this.name} sent an invalid runtime message`);
    }
    const callId = "callId" in message ? message.callId : undefined;
    if (!callId) throw new Error(`isolated extension ${this.name} sent a message without a call id`);
    const pending = this.pending.get(callId);
    if (!pending) return;
    if (message.type === "update") {
      pending.onUpdate?.(message.result);
      return;
    }
    this.finishCall(callId);
    if (message.type === "result") pending.resolve(message.result);
    else pending.reject(new Error(message.message));
  }

  private write(message: HostMessage): void {
    if (!this.child?.stdin.writable) throw new Error(`isolated extension ${this.name} input is closed`);
    const encoded = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(encoded) > this.config.limits.maxMessageBytes) {
      throw new Error(`message to isolated extension ${this.name} exceeds the size limit`);
    }
    this.child.stdin.write(encoded);
  }

  private finishCall(callId: string): PendingCall | undefined {
    const pending = this.pending.get(callId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    this.pending.delete(callId);
    return pending;
  }

  private fail(error: Error): void {
    if (this.closed) return;
    const wasReady = this.ready;
    this.closed = true;
    const startup = this.startup;
    this.startup = undefined;
    startup?.onFailure(error);
    for (const callId of [...this.pending.keys()]) {
      this.finishCall(callId)?.reject(error);
    }
    this.terminate("SIGKILL");
    if (wasReady) this.onRuntimeFailure?.(error);
  }

  private terminate(signal: NodeJS.Signals): void {
    const pid = this.child?.pid;
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch {
      this.child?.kill(signal);
    }
  }

  private waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener("exit", onExit);
        resolve(false);
      }, timeoutMs);
      timer.unref();
      child.once("exit", onExit);
    });
  }
}
