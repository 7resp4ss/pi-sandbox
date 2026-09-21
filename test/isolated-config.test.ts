import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExtensionRuntimeConfig } from "../src/isolated/config.ts";

const originalToken = process.env.TEST_ISOLATED_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.TEST_ISOLATED_TOKEN;
  else process.env.TEST_ISOLATED_TOKEN = originalToken;
});

describe("isolated extension runtime config", () => {
  it("compiles secure defaults through the Sandbox Runtime schema", () => {
    const result = buildExtensionRuntimeConfig({
      config: {
        entry: "/extensions/example/index.ts",
        sandbox: {
          filesystem: {
            allowRead: ["$workspace", "$extension/data"],
            allowWrite: ["$workspace/output"],
          },
          network: { allowedDomains: ["api.example.com:443"] },
        },
      },
      workspace: "/workspace",
      runtimeReadPaths: ["/runtime"],
    });

    expect(result.runtimeConfig.network).toMatchObject({
      allowedDomains: ["api.example.com:443"],
      strictAllowlist: true,
      allowAllUnixSockets: false,
      allowLocalBinding: false,
    });
    expect(result.runtimeConfig.filesystem).toMatchObject({
      disabled: false,
      allowGitConfig: false,
      allowRead: [
        "/extensions/example",
        "/runtime",
        "/workspace",
        "/extensions/example/data",
      ],
      allowWrite: ["/workspace/output"],
    });
    expect(result.runtimeConfig.filesystem.denyRead).toContain(
      process.platform === "darwin" ? "/Users" : "/home",
    );
    expect(result.runtimeConfig).toMatchObject({
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      allowAppleEvents: false,
      allowPty: false,
    });
  });

  it("passes credential values only to SRT and enables TLS termination", () => {
    process.env.TEST_ISOLATED_TOKEN = "real-secret";
    const result = buildExtensionRuntimeConfig({
      config: {
        entry: "/extensions/example.ts",
        sandbox: {
          network: { allowedDomains: ["api.example.com"] },
          credentials: {
            envVars: [
              {
                name: "TEST_ISOLATED_TOKEN",
                mode: "mask",
                injectHosts: ["api.example.com"],
              },
            ],
          },
        },
      },
      workspace: "/workspace",
      runtimeReadPaths: [],
    });

    expect(result.environment.TEST_ISOLATED_TOKEN).toBe("real-secret");
    expect(result.runtimeConfig.network.tlsTerminate).toEqual({});
    expect(result.runtimeConfig.credentials).toMatchObject({
      allowPlaintextInject: false,
      envVars: [
        {
          name: "TEST_ISOLATED_TOKEN",
          mode: "mask",
          injectHosts: ["api.example.com"],
        },
      ],
    });
  });

  it("requires an absolute entry and applies finite default limits", () => {
    expect(() =>
      buildExtensionRuntimeConfig({
        config: { entry: "relative.ts" },
        workspace: "/workspace",
        runtimeReadPaths: [],
      }),
    ).toThrow(/entry must be absolute/);
    const result = buildExtensionRuntimeConfig({
      config: { entry: "/extensions/example.ts" },
      workspace: "/workspace",
      runtimeReadPaths: [],
    });
    expect(result.limits).toEqual({
      startupMs: 5_000,
      callMs: 120_000,
      maxMessageBytes: 1_048_576,
    });
    expect(result.readPaths).toContain(resolve("/extensions"));
  });

  it("does not expose a credential through the non-secret environment list", () => {
    expect(() =>
      buildExtensionRuntimeConfig({
        config: {
          entry: "/extensions/example.ts",
          sandbox: {
            credentials: {
              envVars: [{ name: "TOKEN", mode: "deny" }],
            },
          },
          environment: { allowNonSecret: ["TOKEN"] },
        },
        workspace: "/workspace",
        runtimeReadPaths: [],
      }),
    ).toThrow(/cannot also be allowed as non-secret/);
  });
});
