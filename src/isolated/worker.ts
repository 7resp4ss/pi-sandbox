import { format } from "node:util";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import type {
  HostMessage,
  SerializedTool,
  WorkerMessage,
} from "./protocol.ts";

const entry = process.argv[2];
if (!entry) throw new Error("isolated extension entry is required");

function logToStderr(...args: unknown[]): void {
  process.stderr.write(`${format(...args)}\n`);
}

console.log = logToStderr;
console.info = logToStderr;
console.warn = logToStderr;
console.error = logToStderr;
console.debug = logToStderr;

if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

function send(message: WorkerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorMessage(error: unknown): { message: string; stack?: string } {
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) };
}

function serializeTool(tool: ToolDefinition): SerializedTool {
  if (!tool.name.trim() || !tool.label.trim() || !tool.description.trim()) {
    throw new Error("isolated tools require non-empty name, label, and description");
  }
  if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
    throw new Error(`isolated tool ${tool.name} must define an object parameter schema`);
  }
  if (tool.prepareArguments || tool.renderCall || tool.renderResult) {
    throw new Error(
      `isolated tool ${tool.name} uses unsupported prepareArguments or renderer callbacks`,
    );
  }
  const serialized: SerializedTool = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    constrainedSampling: tool.constrainedSampling,
    executionMode: tool.executionMode,
    renderShell: tool.renderShell,
  };
  JSON.stringify(serialized);
  return serialized;
}

function createToolContext(cwd: string, signal: AbortSignal): ExtensionContext {
  const supported: Record<PropertyKey, unknown> = {
    cwd,
    mode: "rpc",
    hasUI: false,
    signal,
    isProjectTrusted: () => false,
  };
  return new Proxy(supported, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      throw new Error(`isolated tool context property ${String(property)} is not supported`);
    },
  }) as unknown as ExtensionContext;
}

const tools = new Map<string, ToolDefinition>();
let registrationOpen = true;
const apiTarget = {
  registerTool(tool: ToolDefinition): void {
    if (!registrationOpen) throw new Error("isolated tool registration is closed");
    if (tools.has(tool.name)) throw new Error(`duplicate isolated tool: ${tool.name}`);
    serializeTool(tool);
    tools.set(tool.name, tool);
  },
};
const api = new Proxy(apiTarget, {
  get(target, property, receiver) {
    if (property === "registerTool") return Reflect.get(target, property, receiver);
    throw new Error(`ExtensionAPI.${String(property)} is not supported in isolated extensions`);
  },
}) as unknown as ExtensionAPI;

const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
const imported = (await jiti.import(entry, { default: true })) as unknown;
if (typeof imported !== "function") {
  throw new Error(`isolated extension does not export a default factory: ${entry}`);
}
await (imported as ExtensionFactory)(api);
registrationOpen = false;
if (tools.size === 0) throw new Error("isolated extension did not register any tools");
send({ type: "ready", tools: [...tools.values()].map(serializeTool) });

const calls = new Map<string, AbortController>();
let input = "";

async function execute(message: Extract<HostMessage, { type: "execute" }>): Promise<void> {
  const tool = tools.get(message.toolName);
  if (!tool) {
    send({ type: "error", callId: message.callId, message: `unknown isolated tool: ${message.toolName}` });
    return;
  }
  const controller = new AbortController();
  calls.set(message.callId, controller);
  try {
    const result = await tool.execute(
      message.toolCallId,
      message.params as never,
      controller.signal,
      (update) => send({ type: "update", callId: message.callId, result: update }),
      createToolContext(message.cwd, controller.signal),
    );
    send({ type: "result", callId: message.callId, result });
  } catch (error) {
    send({ type: "error", callId: message.callId, ...errorMessage(error) });
  } finally {
    calls.delete(message.callId);
  }
}

function handle(message: HostMessage): void {
  if (message.type === "execute") {
    void execute(message);
  } else if (message.type === "cancel") {
    calls.get(message.callId)?.abort();
  } else {
    for (const controller of calls.values()) controller.abort();
    process.exit(0);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  let newline = input.indexOf("\n");
  while (newline !== -1) {
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (line.trim()) {
      try {
        handle(JSON.parse(line) as HostMessage);
      } catch (error) {
        send({ type: "error", ...errorMessage(error) });
        process.exitCode = 1;
        process.stdin.pause();
        return;
      }
    }
    newline = input.indexOf("\n");
  }
});
