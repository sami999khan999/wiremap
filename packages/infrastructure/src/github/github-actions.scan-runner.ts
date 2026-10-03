import { type ScanRef, ScanRefs, ScanRunner, UnavailableError } from "../import.js";

export interface GithubActionsRunnerConfig {
  // `owner/name` of the repository holding `.github/workflows/scan.yml`.
  readonly repository: string;
  // A token allowed to dispatch that workflow, and nothing more.
  readonly token: string;
  readonly workflow?: string;
  readonly ref?: string;
  readonly apiUrl?: string;
  readonly fetch?: typeof fetch;
}

// Starts a scan as a `workflow_dispatch` run. The scan reference is the run's one input;
// the workflow derives its callback token itself from a secret it holds.
export class GithubActionsScanRunner extends ScanRunner {
  public override readonly configured = true;

  public constructor(private readonly config: GithubActionsRunnerConfig) {
    super();
  }

  public override async dispatch(ref: ScanRef): Promise<void> {
    const http = this.config.fetch ?? fetch;
    const api = this.config.apiUrl ?? "https://api.github.com";
    const workflow = this.config.workflow ?? "scan.yml";
    const response = await http(
      `${api}/repos/${this.config.repository}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "wiremap",
        },
        body: JSON.stringify({
          ref: this.config.ref ?? "main",
          inputs: { scan: ScanRefs.format(ref) },
        }),
      },
    );
    // UNAVAILABLE, so the queue retries: a dispatch GitHub dropped is a scan nobody runs.
    if (!response.ok) throw new UnavailableError("github.actions", response.status);
  }
}
