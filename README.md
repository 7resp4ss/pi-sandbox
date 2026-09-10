# pi-sandbox

Capability-aware filesystem and process sandboxing for pi.

```bash
pi --sandbox r       # workspace read-only
pi --sandbox w       # workspace writable (default)
pi --sandbox yolo    # disable this sandbox explicitly
```

The extension uses `@anthropic-ai/sandbox-runtime` as its OS-level process
boundary and pi's `tool_call` event as the central policy gate for tools that
execute in the pi process itself. Third-party extensions may declare their
capabilities with `declareSandboxTool`. Unmanaged tools are denied in `r` and
`w` by default.

The public capability vocabulary includes `agent.spawn` for the future
subagent broker. Subagent execution is intentionally not marked as managed
until child-process policy inheritance is implemented.
