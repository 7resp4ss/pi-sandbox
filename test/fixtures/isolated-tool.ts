import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

const emptyParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export default function isolatedTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "isolated_echo",
    label: "Isolated echo",
    description: "Echo a value from an isolated worker",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    async execute(_id, params, _signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text", text: `working:${params.value}` }],
        details: { cwd: ctx.cwd },
      });
      return {
        content: [{ type: "text", text: params.value }],
        details: { cwd: ctx.cwd, trusted: ctx.isProjectTrusted() },
      };
    },
  });
  pi.registerTool({
    name: "isolated_env",
    label: "Isolated environment",
    description: "Read an environment variable from the isolated worker",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: process.env[params.name] ?? "<unset>" }],
        details: undefined,
      };
    },
  });
  pi.registerTool({
    name: "isolated_child_process",
    label: "Isolated child process",
    description: "Try to create a child process from the isolated worker",
    parameters: emptyParameters,
    async execute() {
      const output = execFileSync(process.execPath, ["-e", "process.stdout.write('child')"]);
      return {
        content: [{ type: "text", text: output.toString("utf8") }],
        details: undefined,
      };
    },
  });
  pi.registerTool({
    name: "isolated_fetch",
    label: "Isolated fetch",
    description: "Fetch a URL through the Sandbox Runtime proxy",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const response = await fetch(params.url);
      return {
        content: [{ type: "text", text: String(response.status) }],
        details: undefined,
      };
    },
  });
  pi.registerTool({
    name: "isolated_child_read",
    label: "Isolated child read",
    description: "Try to read a file from a child process",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const output = execFileSync("/bin/cat", [params.path]);
      return {
        content: [{ type: "text", text: output.toString("utf8") }],
        details: undefined,
      };
    },
  });
}
