# pi-sandbox

Capability-aware filesystem, process, and network sandboxing for [pi coding agent](https://github.com/badlogic/pi-mono). Shell processes run inside Anthropic's Sandbox Runtime, while pi's `tool_call` event gates tools executed in the pi process. Tools without a declared capability are denied by default.

## Quick start

```bash
npm install
npm run build
pi --extension ./src/index.ts --sandbox r       # workspace read-only
pi --extension ./src/index.ts --sandbox w       # workspace writable (default)
pi --extension ./src/index.ts --sandbox yolo    # explicitly disable sandboxing
```

Use `/sandbox` inside pi to inspect the effective policy. Level `r` permits workspace reads, `w` also permits workspace writes, and `yolo` disables restrictions.

## Flexible permission configuration

Permissions are declared per tool, including orchestration tools such as `subagent`. You can change the policy in `~/.pi/agent/extensions/sandbox.json` or a project-local `.pi/sandbox.json` without changing extension code.

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

An empty capability list marks a tool as orchestration only. This is useful for `subagent`, task scheduling, and coordination tools. Resource operations performed inside a child session are still checked by that session's own policy engine, so delegation cannot bypass sandbox checks.

Combine tool declarations with path and network rules:

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
declareSandboxTool("my_tool", { capabilities: ["filesystem.read"] });
```

## Development

```bash
npm run check   # typecheck and tests
npm run build   # emit dist/
```

The integration entry point is `src/integration/extension.ts`; policy, configuration loading, and capability registration live under `src/policy`, `src/config`, and `src/capabilities`.

## License

MIT
