import { type ScanRef, ScanRefs, ScanRunner, type ScanTokens, spawn } from "../import.js";

export interface LocalRunnerConfig {
  // The built CLI, `apps/cli/dist/index.js`.
  readonly cliPath: string;
  // Where the runner calls back: the web app's own origin.
  readonly serverUrl: string;
}

// Development's runner: the same `wiremap runner` the workflow runs, as a detached child
// process. It needs `git` on the machine, as the workflow's runner image has.
export class LocalScanRunner extends ScanRunner {
  public override readonly configured = true;

  public constructor(
    private readonly config: LocalRunnerConfig,
    private readonly tokens: ScanTokens,
  ) {
    super();
  }

  public override dispatch(ref: ScanRef): Promise<void> {
    const child = spawn(
      process.execPath,
      [
        this.config.cliPath,
        "runner",
        "--server",
        this.config.serverUrl,
        "--scan",
        ScanRefs.format(ref),
        "--token",
        this.tokens.issue(ref),
      ],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return Promise.resolve();
  }
}

// No runner configured: a scan is refused before it is queued, and one queued anyway fails.
export class NullScanRunner extends ScanRunner {
  public override readonly configured = false;

  public override dispatch(): Promise<void> {
    return Promise.resolve();
  }
}
