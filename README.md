# pi-sandbox

Capability-aware filesystem and process sandboxing for pi.

```bash
pi --sandbox r       # workspace read-only
pi --sandbox w       # workspace writable
pi --sandbox yolo    # disable this sandbox explicitly
```

The extension uses `@anthropic-ai/sandbox-runtime` as its OS-level process
boundary and pi's `tool_call` event as the central policy gate for tools that
execute in the pi process itself. Third-party extensions may declare their
capabilities with `declareSandboxTool`. Unmanaged tools are denied in `r` and
`w` by default.

The public capability vocabulary is `filesystem.read`, `filesystem.write`,
`process.execute`, `network.connect`, `credential.read`, and `agent.spawn`.

## Level resolution

A session's own level is the `--sandbox` flag when provided, else `level` in
sandbox.json (`~/.pi/agent/extensions/sandbox.json` merged with
`<cwd>/.pi/sandbox.json`), else `w`.

On top of that, `PI_SANDBOX_LEVEL` acts as an inherited ceiling: the session
runs at the strictest of its own level and the environment value, so
delegation (in-process subagent children, spawned runner processes) can never
widen the level. Every session exports its effective level back to
`PI_SANDBOX_LEVEL` once the sandbox runtime has started; nested delegation
tightens monotonically. The variable is not cleared on shutdown because
children may outlive their parent session. Invalid level values (flag, config,
or environment) fail closed with an error.

## Tool declarations

Sandbox policy is deny-by-default for tools without a capability declaration.
Extensions declare their tools in code with `declareSandboxTool`; users declare
them in sandbox.json with `tools`:

```json
{
  "tools": {
    "subagent":           { "capabilities": [] },
    "bg_wait":            { "capabilities": [] },
    "contact_supervisor": { "capabilities": [] },
    "intercom":           { "capabilities": [] },
    "structured_output":  { "capabilities": [] }
  }
}
```

Empty `capabilities` marks a tool as orchestration: it claims no filesystem,
process, or network access and is passed through. Delegating is orchestration,
not a resource permission — resource tools invoked inside a subagent are
gated per session, because every child session loads its own policy engine
and checks each `read`, `write`, `edit`, and shell call against its resolved
level. The snippet above is the recommended configuration for pi-subagents
users; neither extension needs to know about the other.

Non-empty `capabilities` give tools without a code declaration (such as MCP
tools) a coarse capability label. Config declarations carry no path
extractors, so only the generic `path`/`file_path` input convention applies;
they merge additively onto builtin declarations and cannot remove them.
