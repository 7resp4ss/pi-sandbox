import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentDir, loadConfig } from "../src/config/config-loader.js";

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
