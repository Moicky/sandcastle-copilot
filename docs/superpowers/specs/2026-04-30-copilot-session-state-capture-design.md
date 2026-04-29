# Copilot session-state capture design

## Problem

Sandcastle can run Copilot CLI agents inside Docker or Podman sandboxes, but Copilot CLI stores its runtime logs under the sandbox user's `~/.copilot/session-state`. When the container is removed, those logs are lost, so host-side tooling such as `copilot-usage` cannot analyze the session afterward.

## Approach

Add a Copilot-specific capture path that runs after each Copilot CLI invocation finishes and before the sandbox is torn down. The capture copies the sandbox directory `/home/agent/.copilot/session-state` into the host directory `~/.copilot/session-state`, preserving Copilot CLI's native layout.

This should use the existing session capture phase in `Orchestrator` rather than a Docker cleanup hook. That keeps the behavior tied to the agent provider that owns the files, works for both Docker and Podman bind-mount sandboxes, and lets failures surface through the same error path as existing Claude session capture.

## Alternatives considered

1. Raw Docker cleanup hook: simple for Docker, but it misses Podman and couples the behavior to container teardown rather than agent semantics.
2. Generic artifact-copy API: flexible, but adds public API surface before there is more than one use case.
3. Copilot provider-specific capture: narrow, testable, and consistent with current provider-specific Claude capture. This is the recommended design.

## Components

- `AgentProvider` should describe optional runtime artifact capture in addition to existing session-ID JSONL capture.
- `SessionPaths` should include host and sandbox Copilot session-state roots, defaulting to `~/.copilot/session-state` and `/home/agent/.copilot/session-state`.
- `SessionStore` should gain a helper that copies a session-state directory from a bind-mount sandbox handle to the host without requiring a session ID.
- `Orchestrator` should invoke Copilot session-state capture after the agent stops and before `withSandboxLifecycle` leaves the live sandbox.

## Data flow

1. Copilot CLI runs inside the sandbox with `HOME=/home/agent`.
2. Copilot CLI writes runtime logs under `/home/agent/.copilot/session-state`.
3. After the agent process exits successfully, Sandcastle copies that directory tree to the host `~/.copilot/session-state`.
4. The host directory remains available after container removal for later analysis by `copilot-usage`.

## Error handling

Capture should be attempted only for agent providers that opt in and only when a bind-mount handle with copy support is available. If the sandbox session-state directory does not exist, capture should be treated as a no-op because Copilot CLI versions or failed starts may not create it. If the directory exists but copying fails, the run should fail with `SessionCaptureError` so users do not mistakenly believe usage logs were preserved.

## Testing

Unit tests should cover:

- `copilotCli()` opts into session-state capture.
- The orchestrator copies sandbox Copilot session-state files to the configured host directory.
- Missing sandbox session-state is skipped without failing.
- Copy failures for an existing session-state directory fail the run.

## Documentation

Update the README Copilot CLI section to state that Sandcastle captures Copilot CLI session-state logs from Docker/Podman sandboxes to the host `~/.copilot/session-state` for later `copilot-usage` analysis.
