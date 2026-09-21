import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { IsolatedExtensionClient } from "../src/isolated/client.ts";
import { buildExtensionRuntimeConfig } from "../src/isolated/config.ts";
import { getIsolatedRuntimeReadPaths } from "../src/isolated/manager.ts";

const clients: IsolatedExtensionClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
});

const supported = process.platform === "darwin" || process.platform === "linux";

describe.runIf(supported)("isolated extension client", () => {
  it("loads and executes a tool through a real SRT worker", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const entry = resolve(packageRoot, "test/fixtures/isolated-tool.ts");
    const config = buildExtensionRuntimeConfig({
      config: {
        entry,
        sandbox: { filesystem: { allowRead: ["$workspace"] } },
        limits: { startupMs: 15_000, callMs: 5_000 },
      },
      workspace: packageRoot,
      runtimeReadPaths: getIsolatedRuntimeReadPaths(),
    });
    const client = new IsolatedExtensionClient("fixture", config);
    clients.push(client);
    const tools = await client.start();
    expect(tools).toContainEqual(
      expect.objectContaining({ name: "isolated_echo", label: "Isolated echo" }),
    );
    const updates: string[] = [];
    const result = await client.execute(
      "isolated_echo",
      "tool-call-1",
      { value: "hello" },
      packageRoot,
      undefined,
      (update) => {
        const content = update.content[0];
        if (content?.type === "text") updates.push(content.text);
      },
    );
    expect(updates).toEqual(["working:hello"]);
    expect(result).toMatchObject({
      content: [{ type: "text", text: "hello" }],
      details: { cwd: packageRoot, trusted: false },
    });
    await expect(
      client.execute(
        "isolated_child_process",
        "tool-call-2",
        {},
        packageRoot,
      ),
    ).rejects.toThrow(/restricted|permission|access denied/i);
    await expect(
      client.execute(
        "isolated_fetch",
        "tool-call-3",
        { url: "https://example.com" },
        packageRoot,
      ),
    ).rejects.toThrow(/fetch failed|denied|403/i);
  }, 25_000);

  it("keeps SRT filesystem restrictions on explicitly allowed child processes", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const entry = resolve(packageRoot, "test/fixtures/isolated-tool.ts");
    const outside = await mkdtemp(join(tmpdir(), "pi-sandbox-secret-"));
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "must-not-be-readable");
    try {
      const config = buildExtensionRuntimeConfig({
        config: {
          entry,
          process: { childProcessApi: true },
          limits: { startupMs: 15_000, callMs: 5_000 },
        },
        workspace: packageRoot,
        runtimeReadPaths: getIsolatedRuntimeReadPaths(),
      });
      const client = new IsolatedExtensionClient("child-fixture", config);
      clients.push(client);
      await client.start();
      await expect(
        client.execute(
          "isolated_child_read",
          "tool-call-child-read",
          { path: secret },
          packageRoot,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 25_000);

  it("masks a configured credential before importing the extension", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const entry = resolve(packageRoot, "test/fixtures/isolated-tool.ts");
    const previous = process.env.TEST_ISOLATED_SECRET;
    process.env.TEST_ISOLATED_SECRET = "real-secret-value";
    const config = buildExtensionRuntimeConfig({
      config: {
        entry,
        sandbox: {
          network: { allowedDomains: ["api.example.com"] },
          credentials: {
            envVars: [
              {
                name: "TEST_ISOLATED_SECRET",
                mode: "mask",
                injectHosts: ["api.example.com"],
              },
            ],
          },
        },
        limits: { startupMs: 15_000, callMs: 5_000 },
      },
      workspace: packageRoot,
      runtimeReadPaths: getIsolatedRuntimeReadPaths(),
    });
    if (previous === undefined) delete process.env.TEST_ISOLATED_SECRET;
    else process.env.TEST_ISOLATED_SECRET = previous;
    const client = new IsolatedExtensionClient("credential-fixture", config);
    clients.push(client);
    await client.start();
    const result = await client.execute(
      "isolated_env",
      "tool-call-credential",
      { name: "TEST_ISOLATED_SECRET" },
      packageRoot,
    );
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").not.toBe(
      "real-secret-value",
    );
  }, 25_000);

  it("fails closed when an extension uses an unsupported host API", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const entry = resolve(packageRoot, "test/fixtures/isolated-unsupported.ts");
    const config = buildExtensionRuntimeConfig({
      config: { entry, limits: { startupMs: 15_000 } },
      workspace: packageRoot,
      runtimeReadPaths: getIsolatedRuntimeReadPaths(),
    });
    const client = new IsolatedExtensionClient("unsupported-fixture", config);
    clients.push(client);
    await expect(client.start()).rejects.toThrow(/ExtensionAPI\.on is not supported/);
  }, 25_000);
});
