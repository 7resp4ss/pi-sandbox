import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export interface SerializedTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: ToolDefinition["parameters"];
  constrainedSampling?: ToolDefinition["constrainedSampling"];
  executionMode?: ToolDefinition["executionMode"];
  renderShell?: ToolDefinition["renderShell"];
}

export type HostMessage =
  | {
      type: "execute";
      callId: string;
      toolName: string;
      toolCallId: string;
      params: unknown;
      cwd: string;
    }
  | { type: "cancel"; callId: string }
  | { type: "shutdown" };

export type WorkerMessage =
  | { type: "ready"; tools: SerializedTool[] }
  | { type: "update"; callId: string; result: AgentToolResult<unknown> }
  | { type: "result"; callId: string; result: AgentToolResult<unknown> }
  | {
      type: "error";
      callId?: string;
      message: string;
      stack?: string;
    };
