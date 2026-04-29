---
"@ai-hero/sandcastle": patch
---

Add Copilot CLI as an agent provider and make it the default init selection with `gpt-5.5`.
Generated sandbox Dockerfiles now keep `/home/agent` writable when Docker maps containers to the host UID.
`sandcastle init` now detects npm vs pnpm projects, exposes `--package-manager npm|pnpm`, installs pnpm in generated sandboxes when selected, and writes matching install hooks.
Copilot CLI JSON output parsing now ignores session/tool metadata and uses the final assistant answer as the run result; planner templates also avoid parsing echoed `<plan>` examples.
