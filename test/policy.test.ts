import { describe, expect, it } from "vitest";
import { createCapabilityRegistry } from "../src/capabilities/capability-registry.js";
import { extractPaths } from "../src/integration/tool-input-extractors.js";
import { normalizeSandboxLevel } from "../src/policy/levels.js";
import { buildEffectivePolicy } from "../src/policy/policy-builder.js";
import { createPolicyEngine } from "../src/policy/policy-engine.js";

describe("sandbox policy", () => {
  it("allows workspace reads and denies workspace writes in r", () => {
    const registry = createCapabilityRegistry();
    registry.register({ toolName: "read", capabilities: ["filesystem.read"] });
    registry.register({
      toolName: "write",
      capabilities: ["filesystem.write"],
    });
    const engine = createPolicyEngine(
      buildEffectivePolicy({ level: "r" }, "/workspace"),
      registry,
    );
    expect(
      engine.check({
        toolName: "read",
        readPaths: ["src/a.ts"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(true);
    expect(
      engine.check({
        toolName: "write",
        writePaths: ["src/a.ts"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(false);
  });

  it("denies undeclared tools by default", () => {
    const engine = createPolicyEngine(
      buildEffectivePolicy({ level: "w" }, "/workspace"),
      createCapabilityRegistry(),
    );
    expect(engine.check({ toolName: "glob", cwd: "/workspace" }).allowed).toBe(
      false,
    );
  });

  it("merges third-party capability declarations", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      toolName: "glob",
      capabilities: ["filesystem.read"],
      paths: { read: (input) => [String(input.path)] },
    });
    registry.register({
      toolName: "glob",
      capabilities: ["network.connect"],
      paths: { write: (input) => [String(input.output)] },
    });
    expect(registry.lookup("glob")?.capabilities).toEqual([
      "filesystem.read",
      "network.connect",
    ]);
    expect(
      registry.lookup("glob")?.paths?.read?.({ path: "a" }, { cwd: "/w" }),
    ).toEqual(["a"]);
    expect(
      registry.lookup("glob")?.paths?.write?.({ output: "b" }, { cwd: "/w" }),
    ).toEqual(["b"]);
  });

  it("supports yolo and rejects the removed danger name", () => {
    expect(normalizeSandboxLevel("yolo")).toBe("yolo");
    expect(() => normalizeSandboxLevel("danger")).toThrow(
      /expected r, w, or yolo/,
    );
  });

  it("protects sensitive and workspace-external paths", () => {
    const registry = createCapabilityRegistry();
    registry.register({ toolName: "read", capabilities: ["filesystem.read"] });
    registry.register({
      toolName: "write",
      capabilities: ["filesystem.write"],
    });
    const engine = createPolicyEngine(
      buildEffectivePolicy({ level: "w" }, "/workspace"),
      registry,
    );
    expect(
      engine.check({
        toolName: "read",
        readPaths: [".env.local"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(false);
    expect(
      engine.check({
        toolName: "read",
        readPaths: ["~/.ssh/id_ed25519"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(false);
    expect(
      engine.check({
        toolName: "write",
        writePaths: ["../outside.txt"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(false);
  });
});

describe("extractPaths", () => {
  it("falls back to builtin conventions without a declaration", () => {
    expect(extractPaths("read", { path: "a.ts" }, undefined, "/w")).toEqual({
      readPaths: ["a.ts"],
      writePaths: [],
    });
    expect(extractPaths("write", { path: "a.ts" }, undefined, "/w")).toEqual({
      readPaths: [],
      writePaths: ["a.ts"],
    });
    expect(
      extractPaths("edit", { file_path: "a.ts" }, undefined, "/w"),
    ).toEqual({ readPaths: ["a.ts"], writePaths: ["a.ts"] });
    expect(extractPaths("bash", { command: "ls" }, undefined, "/w")).toEqual({
      readPaths: [],
      writePaths: [],
    });
  });

  it("prefers declaration extractors and passes them the cwd", () => {
    const seenContexts: string[] = [];
    const declaration = {
      toolName: "custom",
      capabilities: ["filesystem.read"],
      paths: {
        read: (input: Record<string, unknown>, ctx: { cwd: string }) => {
          seenContexts.push(ctx.cwd);
          return [String(input.src)];
        },
      },
    } as const;
    expect(extractPaths("custom", { src: "x" }, declaration, "/w")).toEqual({
      readPaths: ["x"],
      writePaths: [],
    });
    expect(seenContexts).toEqual(["/w"]);
  });
});

describe("config-declared tools", () => {
  it("denies an undeclared orchestration tool and explains the fix", () => {
    const registry = createCapabilityRegistry();
    const engine = createPolicyEngine(
      buildEffectivePolicy({ level: "w" }, "/workspace"),
      registry,
    );
    const decision = engine.check({ toolName: "subagent", cwd: "/workspace" });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({
      reason: expect.stringMatching(/declare it via "tools" in sandbox\.json/),
    });
  });

  it("passes through a declared orchestration tool in w and r", () => {
    const registry = createCapabilityRegistry();
    registry.register({ toolName: "subagent", capabilities: [] });
    for (const level of ["w", "r"] as const) {
      const engine = createPolicyEngine(
        buildEffectivePolicy({ level }, "/workspace"),
        registry,
      );
      expect(
        engine.check({ toolName: "subagent", cwd: "/workspace" }).allowed,
      ).toBe(true);
    }
  });

  it("applies capability-level semantics to config-declared resource tools", () => {
    const registry = createCapabilityRegistry();
    registry.register({
      toolName: "mcp__fs__save",
      capabilities: ["filesystem.write"],
    });
    const readonly = createPolicyEngine(
      buildEffectivePolicy({ level: "r" }, "/workspace"),
      registry,
    );
    expect(
      readonly.check({ toolName: "mcp__fs__save", cwd: "/workspace" })
        .allowed,
    ).toBe(false);
    const writable = createPolicyEngine(
      buildEffectivePolicy({ level: "w" }, "/workspace"),
      registry,
    );
    expect(
      writable.check({ toolName: "mcp__fs__save", cwd: "/workspace" })
        .allowed,
    ).toBe(true);
    // The generic path/file_path convention still applies to config-declared
    // tools: a workspace-external path is denied even in w.
    expect(
      writable.check({
        toolName: "mcp__fs__save",
        readPaths: ["../outside.txt"],
        cwd: "/workspace",
      }).allowed,
    ).toBe(false);
  });
});
