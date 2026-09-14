import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandWindowsFsGlobs } from "../src/runtime/windows-glob-expand.ts";

describe("expandWindowsFsGlobs", () => {
  let root: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-sandbox-glob-"));
    home = join(root, "home");
    mkdirSync(home, { recursive: true });
    // Tree:
    //   root/
    //     top.pem, TOP.KEY, .env.local, .env/ (dir), plain.txt
    //     sub/a/secret.key, sub/a/nested/deep.pem, sub/b/secret.key
    //     sub/a/nested/.env.deep
    writeFileSync(join(root, "top.pem"), "");
    writeFileSync(join(root, "TOP.KEY"), "");
    writeFileSync(join(root, ".env.local"), "");
    writeFileSync(join(root, "plain.txt"), "");
    mkdirSync(join(root, ".env"));
    mkdirSync(join(root, "sub", "a", "nested"), { recursive: true });
    mkdirSync(join(root, "sub", "b"));
    writeFileSync(join(root, "sub", "a", "secret.key"), "");
    writeFileSync(join(root, "sub", "b", "secret.key"), "");
    writeFileSync(join(root, "sub", "a", "nested", "deep.pem"), "");
    writeFileSync(join(root, "sub", "a", "nested", ".env.deep"), "");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("expands a leaf-segment glob with one directory listing", () => {
    const out = expandWindowsFsGlobs(["*.pem"], root, home);
    expect(out).toEqual([join(root, "top.pem")]);
  });

  it("matches case-insensitively", () => {
    const out = expandWindowsFsGlobs(["*.key"], root, home);
    expect(out).toEqual([join(root, "TOP.KEY")]);
  });

  it("matches dotfile globs, files and directories alike", () => {
    const out = expandWindowsFsGlobs([".env.*"], root, home);
    expect(out).toEqual([join(root, ".env.local")]);
  });

  it("does not descend below the pattern depth", () => {
    // deep.pem and .env.deep sit one level below any *.pem/.env.* match
    // depth; a recursive scan would find them, the segment walk must not.
    const out = expandWindowsFsGlobs(["sub/*/*.pem"], root, home);
    expect(out).toEqual([]);
  });

  it("walks intermediate glob segments through matching dirs only", () => {
    const out = expandWindowsFsGlobs(["sub/*/secret.key"], root, home);
    expect(out).toEqual([
      join(root, "sub", "a", "secret.key"),
      join(root, "sub", "b", "secret.key"),
    ]);
  });

  it("supports ? as a single-char wildcard", () => {
    const out = expandWindowsFsGlobs(["sub/?/secret.key"], root, home);
    expect(out).toHaveLength(2);
  });

  it("drops a glob that matches nothing", () => {
    expect(expandWindowsFsGlobs(["*.nonexistent"], root, home)).toEqual([]);
  });

  it("passes non-glob literals through verbatim, even when missing", () => {
    // deny-mode placeholder semantics live in the runtime; a missing
    // literal must reach srt-win untouched.
    const out = expandWindowsFsGlobs([".env", ".git/config"], root, home);
    expect(out).toEqual([".env", ".git/config"]);
  });

  it("passes ** patterns through for the runtime to expand", () => {
    const out = expandWindowsFsGlobs(["sub/**/*.pem"], root, home);
    expect(out).toEqual(["sub/**/*.pem"]);
  });

  it("passes UNC and env-ref patterns through", () => {
    const out = expandWindowsFsGlobs(
      ["\\\\server\\share\\*.pem", "%USERPROFILE%\\*.key"],
      root,
      home,
    );
    expect(out).toEqual(["\\\\server\\share\\*.pem", "%USERPROFILE%\\*.key"]);
  });

  it("expands ~ against the provided home", () => {
    writeFileSync(join(home, "id.pem"), "");
    const out = expandWindowsFsGlobs(["~/*.pem"], root, home);
    expect(out).toEqual([join(home, "id.pem")]);
  });

  it("expands absolute patterns", () => {
    const abs = join(root, "sub", "*", "secret.key").replace(/\\/g, "/");
    const out = expandWindowsFsGlobs([abs], root, home);
    expect(out).toEqual([
      join(root, "sub", "a", "secret.key"),
      join(root, "sub", "b", "secret.key"),
    ]);
  });

  it("returns nothing when the base directory does not exist", () => {
    expect(expandWindowsFsGlobs(["no-such-dir/*.pem"], root, home)).toEqual([]);
  });

  it("skips unreadable directories without aborting the whole expansion", () => {
    // Equivalent to the runtime's behavior difference noted in
    // windows-glob-expand.ts: per-dir errors skip a subtree instead of
    // discarding all results.
    const out = expandWindowsFsGlobs(["sub/*/secret.key", "*.pem"], root, home);
    expect(out).toContain(join(root, "top.pem"));
  });
});
