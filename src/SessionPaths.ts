import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Layer } from "effect";

const HOST_COPILOT_SESSION_STATE_DIR = join(
  homedir(),
  ".copilot",
  "session-state",
);
const SANDBOX_COPILOT_SESSION_STATE_DIR = join(
  "/home/agent",
  ".copilot",
  "session-state",
);

/**
 * Host- and sandbox-side Claude `projects` directories used by the
 * orchestrator when capturing and resuming agent sessions.
 */
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

/** Build a `SessionPaths` layer with explicit host and sandbox project directories. */
export const sessionPathsLayer = (config: {
  readonly hostProjectsDir: string;
  readonly sandboxProjectsDir: string;
  readonly hostCopilotSessionStateDir?: string;
  readonly sandboxCopilotSessionStateDir?: string;
}): Layer.Layer<SessionPaths> =>
  Layer.succeed(SessionPaths, {
    hostCopilotSessionStateDir: HOST_COPILOT_SESSION_STATE_DIR,
    sandboxCopilotSessionStateDir: SANDBOX_COPILOT_SESSION_STATE_DIR,
    ...config,
  });

/**
 * Default `SessionPaths` layer using Claude Code's conventional locations:
 * `~/.claude/projects` on the host and `/home/agent/.claude/projects` in the
 * sandbox.
 */
export const defaultSessionPathsLayer: Layer.Layer<SessionPaths> = Layer.sync(
  SessionPaths,
  () => ({
    hostProjectsDir: join(homedir(), ".claude", "projects"),
    sandboxProjectsDir: join("/home/agent", ".claude", "projects"),
    hostCopilotSessionStateDir: HOST_COPILOT_SESSION_STATE_DIR,
    sandboxCopilotSessionStateDir: SANDBOX_COPILOT_SESSION_STATE_DIR,
  }),
);
