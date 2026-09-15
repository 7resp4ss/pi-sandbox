import { describe, expect, it } from "vitest";
import {
  normalizeSandboxLevel,
  resolveSessionLevel,
  strictestLevel,
} from "../src/policy/levels.ts";

describe("strictestLevel", () => {
  it("picks the more restrictive level for every pair", () => {
    expect(strictestLevel("r", "r")).toBe("r");
    expect(strictestLevel("r", "w")).toBe("r");
    expect(strictestLevel("w", "r")).toBe("r");
    expect(strictestLevel("r", "yolo")).toBe("r");
    expect(strictestLevel("yolo", "r")).toBe("r");
    expect(strictestLevel("w", "w")).toBe("w");
    expect(strictestLevel("w", "yolo")).toBe("w");
    expect(strictestLevel("yolo", "w")).toBe("w");
    expect(strictestLevel("yolo", "yolo")).toBe("yolo");
  });
});

describe("resolveSessionLevel", () => {
  it("defaults to w when nothing is provided", () => {
    expect(resolveSessionLevel({})).toBe("w");
  });

  it("lets an explicit flag override the config level", () => {
    expect(
      resolveSessionLevel({ flag: "yolo", configLevel: "r" }),
    ).toBe("yolo");
    expect(
      resolveSessionLevel({ flag: "readonly", configLevel: "w" }),
    ).toBe("r");
  });

  it("uses the config level when the flag is absent (dead-config regression)", () => {
    expect(resolveSessionLevel({ configLevel: "r" })).toBe("r");
    expect(resolveSessionLevel({ flag: undefined, configLevel: "w" })).toBe(
      "w",
    );
  });

  it("treats blank flag and config values as absent", () => {
    expect(resolveSessionLevel({ flag: "  ", configLevel: "r" })).toBe("r");
    expect(resolveSessionLevel({ configLevel: "" })).toBe("w");
  });

  it("tightens to the environment ceiling", () => {
    expect(resolveSessionLevel({ env: "r" })).toBe("r");
    expect(resolveSessionLevel({ flag: "w", env: "r" })).toBe("r");
    expect(resolveSessionLevel({ configLevel: "r", env: "w" })).toBe("r");
  });

  it("never widens through the environment ceiling", () => {
    expect(resolveSessionLevel({ env: "yolo" })).toBe("w");
    expect(resolveSessionLevel({ flag: "w", env: "yolo" })).toBe("w");
    expect(
      resolveSessionLevel({ configLevel: "r", env: "yolo" }),
    ).toBe("r");
    expect(
      resolveSessionLevel({ flag: "yolo", configLevel: undefined, env: "yolo" }),
    ).toBe("yolo");
  });

  it("treats a blank environment value as unset", () => {
    expect(resolveSessionLevel({ configLevel: "w", env: "" })).toBe("w");
  });

  it("fails closed on invalid values from any source", () => {
    expect(() => resolveSessionLevel({ flag: "danger" })).toThrow(
      /expected r, w, or yolo/,
    );
    expect(() => resolveSessionLevel({ configLevel: "rw" })).toThrow(
      /expected r, w, or yolo/,
    );
    expect(() => resolveSessionLevel({ env: "unsafe" })).toThrow(
      /expected r, w, or yolo/,
    );
  });

  it("accepts the same synonyms as normalizeSandboxLevel", () => {
    expect(resolveSessionLevel({ flag: "read" })).toBe("r");
    expect(resolveSessionLevel({ flag: "write" })).toBe("w");
    expect(resolveSessionLevel({ configLevel: "readonly" })).toBe("r");
    expect(normalizeSandboxLevel("read")).toBe("r");
  });
});
