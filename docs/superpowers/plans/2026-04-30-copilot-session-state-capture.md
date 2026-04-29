# Copilot Session-State Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Copilot CLI runtime logs by copying sandbox `~/.copilot/session-state` into the host `~/.copilot/session-state` after each Copilot CLI agent run.

**Architecture:** Extend the existing provider-driven session capture flow instead of adding Docker-specific teardown behavior. `copilotCli()` opts into a new runtime artifact capture flag; `Orchestrator` copies the configured sandbox session-state directory to the configured host directory while the live bind-mount sandbox handle is still available.

**Tech Stack:** TypeScript, Effect, Node `fs/promises`, Vitest, existing Sandcastle sandbox provider interfaces.

---

## File structure

- Modify `src/AgentProvider.ts`: add an optional `captureSessionState` capability and set it on `copilotCli()`.
- Modify `src/SessionPaths.ts`: add host/sandbox Copilot session-state directories to the session path layer.
- Modify `src/SessionStore.ts`: add a focused helper to copy a sandbox directory tree to the host and skip missing source directories.
- Modify `src/Orchestrator.ts`: call the helper after the agent stops and before sandbox teardown.
- Modify `src/AgentProvider.test.ts`: update Copilot provider expectations.
- Modify `src/SessionStore.test.ts`: cover directory capture helper behavior.
- Modify `src/Orchestrator.test.ts`: cover orchestration-level capture, missing source skip, and copy failure.
- Modify `README.md`: document Copilot CLI session-state capture.
- Create `.changeset/<slug>.md`: patch changeset for the behavior change.

## Task 1: Provider capability flag

**Files:**

- Modify: `src/AgentProvider.ts:115-126`
- Modify: `src/AgentProvider.ts:426-460`
- Test: `src/AgentProvider.test.ts:802-805`

- [ ] **Step 1: Write the failing provider test**

Replace the existing Copilot capture assertion in `src/AgentProvider.test.ts` with:

```ts
it("captures Copilot CLI session-state", () => {
  const provider = copilotCli("gpt-5.5");
  expect(provider.captureSessions).toBe(false);
  expect(provider.captureSessionState).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run test -- src/AgentProvider.test.ts -t "captures Copilot CLI session-state"
```

Expected: fail because `captureSessionState` is undefined.

- [ ] **Step 3: Add the provider capability**

In `src/AgentProvider.ts`, update `AgentProvider`:

```ts
export interface AgentProvider {
  readonly name: string;
  /** Environment variables injected by this agent provider. Merged at launch time with env resolver and sandbox provider env. */
  readonly env: Record<string, string>;
  /** When true, session capture is enabled for this provider. Default: true for Claude Code, false for others. */
  readonly captureSessions: boolean;
  /** When true, copy the provider's sandbox session-state directory to the host after a run. */
  readonly captureSessionState?: boolean;
  buildPrintCommand(options: AgentCommandOptions): PrintCommand;
  buildInteractiveArgs?(options: AgentCommandOptions): string[];
  parseStreamLine(line: string): ParsedStreamEvent[];
  /** Parse token usage from the captured session JSONL content. Only implemented by Claude Code. */
  parseSessionUsage?(content: string): IterationUsage | undefined;
}
```

In `copilotCli()`, set:

```ts
captureSessions: false,
captureSessionState: true,
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm run test -- src/AgentProvider.test.ts -t "captures Copilot CLI session-state"
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/AgentProvider.ts src/AgentProvider.test.ts
git commit -m "feat: mark copilot sessions for capture"
```

## Task 2: Session path configuration

**Files:**

- Modify: `src/SessionPaths.ts`

- [ ] **Step 1: Update the path layer types**

Change `SessionPaths` to include Copilot session-state directories:

```ts
export class SessionPaths extends Context.Tag("SessionPaths")<
  SessionPaths,
  {
    /** Host path to the Claude Code projects directory. */
    readonly hostProjectsDir: string;
    /** Sandbox path to the Claude Code projects directory. */
    readonly sandboxProjectsDir: string;
    /** Host path to the Copilot CLI session-state directory. */
    readonly hostCopilotSessionStateDir: string;
    /** Sandbox path to the Copilot CLI session-state directory. */
    readonly sandboxCopilotSessionStateDir: string;
  }
>() {}
```

- [ ] **Step 2: Keep tests ergonomic with optional overrides**

Replace `sessionPathsLayer` with:

```ts
export const sessionPathsLayer = (config: {
  readonly hostProjectsDir: string;
  readonly sandboxProjectsDir: string;
  readonly hostCopilotSessionStateDir?: string;
  readonly sandboxCopilotSessionStateDir?: string;
}): Layer.Layer<SessionPaths> =>
  Layer.succeed(SessionPaths, {
    hostCopilotSessionStateDir: join(
      process.env.HOME ?? "~",
      ".copilot",
      "session-state",
    ),
    sandboxCopilotSessionStateDir: join(
      "/home/agent",
      ".copilot",
      "session-state",
    ),
    ...config,
  });
```

- [ ] **Step 3: Update default paths**

Replace `defaultSessionPathsLayer` payload with:

```ts
{
  hostProjectsDir: join(process.env.HOME ?? "~", ".claude", "projects"),
  sandboxProjectsDir: join("/home/agent", ".claude", "projects"),
  hostCopilotSessionStateDir: join(
    process.env.HOME ?? "~",
    ".copilot",
    "session-state",
  ),
  sandboxCopilotSessionStateDir: join(
    "/home/agent",
    ".copilot",
    "session-state",
  ),
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/SessionPaths.ts
git commit -m "feat: add copilot session-state paths"
```

## Task 3: Directory capture helper

**Files:**

- Modify: `src/SessionStore.ts`
- Test: `src/SessionStore.test.ts`

- [ ] **Step 1: Write helper tests**

Add these imports in `src/SessionStore.test.ts`:

```ts
import { cp, stat } from "node:fs/promises";
import { captureSandboxDirectoryToHost } from "./SessionStore.js";
```

Add a `describe("captureSandboxDirectoryToHost", ...)` block with tests for copied, missing, and copy-failure behavior:

```ts
describe("captureSandboxDirectoryToHost", () => {
  it("copies a sandbox directory tree into an existing host directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sandcastle-state-copy-"));
    try {
      const sandboxDir = join(root, "sandbox", "session-state");
      const hostDir = join(root, "host", "session-state");
      await mkdir(join(sandboxDir, "session-a"), { recursive: true });
      await writeFile(join(sandboxDir, "session-a", "log.jsonl"), "{}\n");
      await mkdir(hostDir, { recursive: true });
      await writeFile(join(hostDir, "existing.txt"), "keep");

      const handle: Pick<BindMountSandboxHandle, "copyFileOut" | "exec"> = {
        exec: async (command: string) => ({
          stdout: "",
          stderr: "",
          exitCode: command.includes("test -d") ? 0 : 1,
        }),
        copyFileOut: async (from: string, to: string) => {
          await cp(from, join(to, "session-state"), {
            recursive: true,
            force: true,
          });
        },
      };

      const result = await captureSandboxDirectoryToHost(
        handle,
        sandboxDir,
        hostDir,
      );

      expect(result).toBe("copied");
      await expect(
        readFile(join(hostDir, "existing.txt"), "utf-8"),
      ).resolves.toBe("keep");
      await expect(
        readFile(join(hostDir, "session-a", "log.jsonl"), "utf-8"),
      ).resolves.toBe("{}\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips capture when the sandbox directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sandcastle-state-missing-"));
    try {
      let copyCalled = false;
      const handle: Pick<BindMountSandboxHandle, "copyFileOut" | "exec"> = {
        exec: async () => ({ stdout: "", stderr: "", exitCode: 1 }),
        copyFileOut: async () => {
          copyCalled = true;
        },
      };

      const result = await captureSandboxDirectoryToHost(
        handle,
        "/missing/session-state",
        join(root, "host"),
      );

      expect(result).toBe("missing");
      expect(copyCalled).toBe(false);
      await expect(stat(join(root, "host"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces copy failures when the sandbox directory exists", async () => {
    const handle: Pick<BindMountSandboxHandle, "copyFileOut" | "exec"> = {
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      copyFileOut: async () => {
        throw new Error("copy exploded");
      },
    };

    await expect(
      captureSandboxDirectoryToHost(handle, "/sandbox/state", "/host/state"),
    ).rejects.toThrow("copy exploded");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm run test -- src/SessionStore.test.ts -t "captureSandboxDirectoryToHost"
```

Expected: fail because the helper is not exported.

- [ ] **Step 3: Implement the helper**

Update imports in `src/SessionStore.ts`:

```ts
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
```

Add the helper before `transferSession`:

```ts
export type DirectoryCaptureResult = "copied" | "missing";

/**
 * Copy a sandbox directory tree into a host directory.
 *
 * Missing sandbox directories are skipped so agents that do not create runtime
 * state do not fail otherwise successful runs.
 */
export const captureSandboxDirectoryToHost = async (
  handle: Pick<BindMountSandboxHandle, "copyFileOut" | "exec">,
  sandboxDir: string,
  hostDir: string,
): Promise<DirectoryCaptureResult> => {
  const exists = await handle.exec(`test -d ${JSON.stringify(sandboxDir)}`);
  if (exists.exitCode !== 0) {
    return "missing";
  }

  const tmpParent = await mkdtemp(join(tmpdir(), "sandcastle-session-state-"));
  try {
    await handle.copyFileOut(sandboxDir, tmpParent);
    await mkdir(hostDir, { recursive: true });
    await cp(join(tmpParent, basename(sandboxDir)), hostDir, {
      recursive: true,
      force: true,
    });
    return "copied";
  } finally {
    await rm(tmpParent, { recursive: true, force: true }).catch(() => {});
  }
};
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
npm run test -- src/SessionStore.test.ts -t "captureSandboxDirectoryToHost"
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/SessionStore.ts src/SessionStore.test.ts
git commit -m "feat: copy sandbox session-state directories"
```

## Task 4: Orchestrator integration

**Files:**

- Modify: `src/Orchestrator.ts`
- Test: `src/Orchestrator.test.ts`

- [ ] **Step 1: Add orchestration tests**

Add tests near the existing session capture tests in `src/Orchestrator.test.ts`.

Use the existing `makeSessionCaptureFactory` helper pattern. Each mock agent should create or omit files under the configured `sandboxCopilotSessionStateDir`, and each test should provide `sessionPathsLayer({ hostProjectsDir, sandboxProjectsDir, hostCopilotSessionStateDir, sandboxCopilotSessionStateDir })`.

The copied-file test should assert:

```ts
expect(
  await readFile(
    join(hostCopilotSessionStateDir, "session-a", "log.jsonl"),
    "utf-8",
  ),
).toBe("{}\n");
```

The missing-directory test should assert the run resolves and `hostCopilotSessionStateDir` does not exist.

The copy-failure test should use a factory handle whose `copyFileOut` throws for the Copilot session-state path and assert:

```ts
await expect(runPromise).rejects.toMatchObject({
  _tag: "SessionCaptureError",
});
```

- [ ] **Step 2: Run the focused orchestration tests and verify they fail**

Run:

```bash
npm run test -- src/Orchestrator.test.ts -t "Copilot session-state"
```

Expected: fail because orchestrator does not invoke the helper yet.

- [ ] **Step 3: Wire capture into `Orchestrator`**

Update the import from `SessionStore.js`:

```ts
import {
  captureSandboxDirectoryToHost,
  hostSessionStore,
  sandboxSessionStore,
  transferSession,
} from "./SessionStore.js";
```

Update the `SessionPaths` destructure:

```ts
const {
  hostProjectsDir,
  sandboxProjectsDir,
  hostCopilotSessionStateDir,
  sandboxCopilotSessionStateDir,
} = yield * SessionPaths;
```

After `yield* display.status(label("Agent stopped"), "info");` and before Claude JSONL capture, add:

```ts
if (provider.captureSessionState && bindMountHandle) {
  yield * display.status(label("Capturing session state"), "info");
  yield *
    Effect.tryPromise({
      try: () =>
        captureSandboxDirectoryToHost(
          bindMountHandle,
          sandboxCopilotSessionStateDir,
          hostCopilotSessionStateDir,
        ),
      catch: (e) =>
        new SessionCaptureError({
          message: `Session state capture failed: ${e instanceof Error ? e.message : String(e)}`,
          sessionId: "copilot-session-state",
        }),
    });
}
```

- [ ] **Step 4: Run the focused orchestration tests and verify they pass**

Run:

```bash
npm run test -- src/Orchestrator.test.ts -t "Copilot session-state"
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/Orchestrator.ts src/Orchestrator.test.ts
git commit -m "feat: capture copilot session state after runs"
```

## Task 5: Documentation and changeset

**Files:**

- Modify: `README.md:772-785`
- Create: `.changeset/copilot-session-state-capture.md`

- [ ] **Step 1: Update README**

In the `CopilotCliOptions` section, add:

```md
After each successful `copilotCli()` run in a Docker or Podman sandbox, Sandcastle copies Copilot CLI's sandbox session-state directory from `/home/agent/.copilot/session-state` to the host `~/.copilot/session-state`. This preserves the runtime logs for later analysis with tools such as `copilot-usage`. Missing session-state directories are skipped; copy failures fail the run.
```

- [ ] **Step 2: Add changeset**

Create `.changeset/copilot-session-state-capture.md`:

```md
---
"@ai-hero/sandcastle": patch
---

Capture Copilot CLI sandbox session-state logs to the host `~/.copilot/session-state` after agent runs.
```

- [ ] **Step 3: Run format check**

Run:

```bash
npm run format:check
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add README.md .changeset/copilot-session-state-capture.md
git commit -m "docs: document copilot session-state capture"
```

## Task 6: Full verification

**Files:**

- No source edits expected.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm run test
```

Expected: pass.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git --no-pager status --short
```

Expected: clean except for any intentionally uncommitted user changes that predated implementation.
