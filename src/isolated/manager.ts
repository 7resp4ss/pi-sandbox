import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { IsolatedExtensionConfig } from "../types.ts";
import { IsolatedExtensionClient } from "./client.ts";
import { buildExtensionRuntimeConfig } from "./config.ts";
import type { SerializedTool } from "./protocol.ts";

function dependencyRoot(path: string): string {
  let current = resolve(path);
  while (parse(current).root !== current) {
    const base = parse(current).base;
    if (base === "node_modules" || base === "packages") return current;
    current = dirname(current);
  }
  return dirname(path);
}

export function getIsolatedRuntimeReadPaths(): string[] {
  const ownPath = fileURLToPath(import.meta.url);
  return [...new Set([
    resolve(dirname(ownPath), "../.."),
    dependencyRoot(fileURLToPath(import.meta.resolve("jiti"))),
    dependencyRoot(fileURLToPath(import.meta.resolve("undici"))),
    dependencyRoot(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),
  ])];
}

function proxyTool(client: IsolatedExtensionClient, tool: SerializedTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    parameters: tool.parameters,
    constrainedSampling: tool.constrainedSampling,
    executionMode: tool.executionMode,
    renderShell: tool.renderShell,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      client.execute(tool.name, toolCallId, params, ctx.cwd, signal, onUpdate),
  };
}

export class IsolatedExtensionManager {
  private clients: IsolatedExtensionClient[] = [];

  constructor(private readonly pi: ExtensionAPI) {}

  get activeCount(): number {
    return this.clients.length;
  }

  async start(
    extensions: Record<string, IsolatedExtensionConfig> | undefined,
    workspace: string,
    notify: (message: string) => void,
  ): Promise<void> {
    await this.stop();
    if (!extensions) return;
    const toolNames = new Set(this.pi.getAllTools().map((tool) => tool.name));
    for (const [name, config] of Object.entries(extensions)) {
      let client: IsolatedExtensionClient | undefined;
      try {
        const resolved = buildExtensionRuntimeConfig({
          config,
          workspace,
          runtimeReadPaths: getIsolatedRuntimeReadPaths(),
        });
        const startedClient = new IsolatedExtensionClient(name, resolved, (error) => {
          this.clients = this.clients.filter((candidate) => candidate !== startedClient);
          notify(`${name}: ${error.message}`);
        });
        client = startedClient;
        this.clients.push(startedClient);
        const tools = await client.start();
        const extensionToolNames = new Set<string>();
        for (const tool of tools) {
          if (toolNames.has(tool.name) || extensionToolNames.has(tool.name)) {
            throw new Error(`isolated tool name conflicts with an existing tool: ${tool.name}`);
          }
          extensionToolNames.add(tool.name);
        }
        for (const toolName of extensionToolNames) toolNames.add(toolName);
        for (const tool of tools) this.pi.registerTool(proxyTool(client, tool));
      } catch (error) {
        this.clients = this.clients.filter((candidate) => candidate !== client);
        await client?.stop();
        notify(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async stop(): Promise<void> {
    const clients = this.clients;
    this.clients = [];
    await Promise.all(clients.map((client) => client.stop()));
  }
}
