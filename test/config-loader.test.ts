import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAgentDir,
  loadConfig,
  validateToolDeclarations,
} from "../src/config/config-loader.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
});

describe("agent directory resolution", () => {
  it("uses PI_CODING_AGENT_DIR when set", () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/pi-agent";
    expect(getAgentDir("/home/example")).toBe("/custom/pi-agent");
  });

  it("loads the global config from the resolved agent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sandbox-config-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "sandbox.json"),
      JSON.stringify({ level: "r" }),
    );

    process.env.PI_CODING_AGENT_DIR = agentDir;
    expect(loadConfig(cwd, "/unused-home").level).toBe("r");

    rmSync(root, { recursive: true, force: true });
  });
});

describe("tool declarations", () => {
  it("validates and normalizes declared tools", () => {
    expect(
      validateToolDeclarations(
        {
          subagent: { capabilities: [] },
          "mcp__fs__save": { capabilities: ["filesystem.write"] },
        },
        "tools in test",
      ),
    ).toEqual({
      subagent: { capabilities: [] },
      "mcp__fs__save": { capabilities: ["filesystem.write"] },
    });
    expect(validateToolDeclarations(undefined, "tools in test")).toBeUndefined();
    expect(validateToolDeclarations({}, "tools in test")).toBeUndefined();
  });

  it("rejects invalid shapes and unknown capabilities", () => {
    expect(() => validateToolDeclarations([], "tools in test")).toThrow(
      /must be an object mapping tool names/,
    );
    expect(() =>
      validateToolDeclarations({ "": { capabilities: [] } }, "tools in test"),
    ).toThrow(/contains an empty tool name/);
    expect(() =>
      validateToolDeclarations({ subagent: [] }, "tools in test"),
    ).toThrow(/subagent must be an object/);
    expect(() =>
      validateToolDeclarations(
        { subagent: { capabilities: [], paths: [] } },
        "tools in test",
      ),
    ).toThrow(/unsupported fields: paths/);
    expect(() =>
      validateToolDeclarations({ subagent: {} }, "tools in test"),
    ).toThrow(/capabilities must be an array/);
    expect(() =>
      validateToolDeclarations(
        { subagent: { capabilities: ["nuclear.launch"] } },
        "tools in test",
      ),
    ).toThrow(/invalid capability "nuclear\.launch".*filesystem\.read/s);
  });

  it("loads tools from config files and merges per tool name", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sandbox-tools-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "sandbox.json"),
      JSON.stringify({
        tools: {
          subagent: { capabilities: [] },
          bg_wait: { capabilities: [] },
        },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "sandbox.json"),
      JSON.stringify({
        tools: {
          bg_wait: { capabilities: ["filesystem.read"] },
          "mcp__x__y": { capabilities: ["network.connect"] },
        },
      }),
    );

    process.env.PI_CODING_AGENT_DIR = agentDir;
    expect(loadConfig(cwd, "/unused-home").tools).toEqual({
      subagent: { capabilities: [] },
      bg_wait: { capabilities: ["filesystem.read"] },
      "mcp__x__y": { capabilities: ["network.connect"] },
    });

    rmSync(root, { recursive: true, force: true });
  });

  it("loads isolated extensions only from the global config", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sandbox-isolated-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "sandbox.json"),
      JSON.stringify({
        isolatedExtensions: {
          example: {
            entry: "/extensions/example.ts",
            sandbox: {
              network: { allowedDomains: ["api.example.com:443"] },
            },
          },
        },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;
    expect(loadConfig(cwd, "/unused-home").isolatedExtensions).toEqual({
      example: {
        entry: "/extensions/example.ts",
        sandbox: {
          filesystem: {
            allowRead: undefined,
            denyRead: undefined,
            allowWrite: undefined,
            denyWrite: undefined,
          },
          network: {
            allowedDomains: ["api.example.com:443"],
            deniedDomains: undefined,
          },
          credentials: { files: [], envVars: [] },
        },
        process: { childProcessApi: undefined },
        environment: { allowNonSecret: undefined },
        limits: {
          startupMs: undefined,
          callMs: undefined,
          maxMessageBytes: undefined,
        },
      },
    });

    writeFileSync(
      join(cwd, ".pi", "sandbox.json"),
      JSON.stringify({
        isolatedExtensions: {
          malicious: { entry: "/tmp/malicious.ts" },
        },
      }),
    );
    expect(() => loadConfig(cwd, "/unused-home")).toThrow(
      /isolatedExtensions is only allowed in the global sandbox config/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects unsafe or malformed isolated extension fields", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sandbox-isolated-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "sandbox.json"),
      JSON.stringify({
        isolatedExtensions: {
          example: {
            entry: "/extensions/example.ts",
            sandbox: { network: { allowAllUnixSockets: true } },
          },
        },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;
    expect(() => loadConfig(cwd, "/unused-home")).toThrow(
      /unsupported fields: allowAllUnixSockets/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("fails closed on invalid tools in a config file", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-sandbox-tools-"));
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "sandbox.json"),
      JSON.stringify({ tools: { subagent: { capabilities: ["nope"] } } }),
    );

    process.env.PI_CODING_AGENT_DIR = agentDir;
    expect(() => loadConfig(cwd, "/unused-home")).toThrow(
      /invalid capability "nope"/,
    );

    rmSync(root, { recursive: true, force: true });
  });
});
