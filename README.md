# pi-sandbox

Capability-aware sandboxing for [pi coding agent](https://github.com/badlogic/pi-mono). Shell commands and explicitly isolated extensions run through Anthropic's Sandbox Runtime. Ordinary Pi extensions remain trusted code in the Pi process.

## Quick start

```bash
npm install
npm run build
pi --extension ./src/index.ts --sandbox r       # workspace read-only
pi --extension ./src/index.ts --sandbox w       # workspace writable (default)
pi --extension ./src/index.ts --sandbox yolo    # explicitly disable sandboxing
```

Use `/sandbox` inside pi to inspect the effective policy, and `/sandbox <r|w|yolo>` to switch the running session's level. Level `r` permits workspace reads but blocks declared filesystem writes and network tools. Level `w` also permits writes and configured network access. Level `yolo` disables shell sandboxing, but never disables isolated-extension sandboxes.

Switching rebuilds the policy and restarts the OS sandbox runtime in place; the tool gate, the status bar, and the exported `PI_SANDBOX_LEVEL` follow immediately. A session that inherited `PI_SANDBOX_LEVEL` from its parent can only switch within that ceiling (`strictest(requested, inherited)`), so runtime switching preserves the rule that delegation can never widen a sandbox. If the runtime refuses the new level, the previous level is restored and `/sandbox` reports the failure.

## Host tool declarations

Capabilities declared under `tools` are admission metadata for tools already running in the Pi process. They let pi-sandbox block a tool call before execution, but they cannot intercept arbitrary `fs`, `fetch`, or `child_process` calls made by trusted host extension code.

Supported capabilities are `filesystem.read`, `filesystem.write`, `process.execute`, and `network.connect`:

```json
{
  "tools": {
    "subagent": { "capabilities": [] },
    "web_search": { "capabilities": ["network.connect"] },
    "file_editor": {
      "capabilities": ["filesystem.read", "filesystem.write"]
    }
  }
}
```

An empty capability list marks a tool as orchestration only. Tools without declarations are denied by default. In `r` mode, tools declaring `filesystem.write` or `network.connect` are blocked. Built-in bash and PowerShell are separately enforced by Sandbox Runtime.

Path checks apply when pi-sandbox can extract concrete paths from the tool input. Domain rules apply to Sandbox Runtime processes, not arbitrary network calls in the Pi host process:

```json
{
  "level": "r",
  "unknownTools": "deny",
  "network": { "allowedDomains": ["api.example.com"] },
  "filesystem": { "allowRead": ["./fixtures"] },
  "tools": {
    "subagent": { "capabilities": [] },
    "my_search": { "capabilities": ["network.connect"] }
  }
}
```

The global configuration and project configuration are merged, with project values taking precedence. `PI_SANDBOX_LEVEL` provides an inherited ceiling: child sessions can tighten permissions, but can never widen the effective level of their parent.

Extension authors can declare capabilities in code:

```ts
declareSandboxTool({
  toolName: "my_tool",
  capabilities: ["filesystem.read"],
});
```

## Isolated extensions

Use `isolatedExtensions` for third-party code that must not run in the Pi host process. This section is accepted only in the global config at `~/.pi/agent/extensions/sandbox.json`; project-local configs cannot add isolated code or widen its permissions.

```json
{
  "isolatedExtensions": {
    "example": {
      "entry": "/absolute/path/to/extension.ts",
      "sandbox": {
        "filesystem": {
          "allowRead": ["$workspace", "$extension/data"],
          "allowWrite": ["$workspace/output"]
        },
        "network": {
          "allowedDomains": ["api.example.com:443"]
        },
        "credentials": {
          "envVars": [
            {
              "name": "EXAMPLE_API_KEY",
              "mode": "mask",
              "injectHosts": ["api.example.com:443"]
            }
          ]
        }
      },
      "process": { "childProcessApi": false },
      "environment": { "allowNonSecret": [] },
      "limits": {
        "startupMs": 5000,
        "callMs": 120000,
        "maxMessageBytes": 1048576
      }
    }
  }
}
```

Each entry starts one long-lived `srt` process. The worker imports the extension only after the OS sandbox is active, and Pi registers proxy tools after the worker reports a valid tool list. Startup failure, malformed output, timeout, or process exit disables that extension without falling back to host execution.

`$workspace` expands to the active working directory. `$extension` expands to the directory containing the configured entry. Extension entries must be absolute paths. Isolated extensions must also be removed from Pi's ordinary extension discovery; pi-sandbox cannot undo host code that Pi imported before pi-sandbox started.

The v1 isolated API supports only a default extension factory and `pi.registerTool()`. Commands, events, providers, flags, shortcuts, renderers, `prepareArguments`, and other host APIs fail closed. Tool execution receives a minimal context containing `cwd`, `mode: "rpc"`, `hasUI: false`, `signal`, and `isProjectTrusted()`.

### Enforcement details

- Sandbox Runtime enforces network access, redirects, proxy authentication, credential injection, write policy, and broad read denials on macOS and Linux.
- Node's Permission Model gives the JavaScript extension an allow-only filesystem view and denies `child_process`, Worker, native addons, and WASI by default.
- SRT read rules are deny-then-allow, so pi-sandbox denies user homes, mounted volumes, and temporary roots before re-allowing configured paths. System runtime paths remain readable where required to run Node.
- `childProcessApi: true` opts into Node child-process APIs. Children inherit SRT network, write, and broad read restrictions, but not Node's exact allow-only read list.
- Sandbox Runtime currently permits OS process execution on macOS and does not block `execve` on Linux. `childProcessApi: false` is defense in depth, not a claim of kernel-level process-execution denial.
- Credential `mask` values are replaced with sentinels in the worker and restored by SRT only for matching `injectHosts`. Credential variables must not also be listed in `allowNonSecret`.
- Call and message limits bound RPC work, and a timeout terminates the worker process tree. SRT does not provide CPU or memory quotas, so isolated mode is not a denial-of-service containment boundary.
- Isolated mode fails closed on unsupported platforms. Windows support is not enabled in this version.

## Development

```bash
npm run check   # typecheck and tests
npm run build   # emit dist/
```

The integration entry point is `src/integration/extension.ts`; policy, configuration loading, and capability registration live under `src/policy`, `src/config`, and `src/capabilities`.

## License

MIT
