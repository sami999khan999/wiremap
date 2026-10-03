import type { Clock } from "../import.js";
import type { ProjectRepository } from "../project/index.js";
import type { GithubInstallationRepository } from "./github-installation.repository.js";

// The fields read off a delivery, already parsed; everything else in the payload is ignored.
export interface GithubWebhookEvent {
  readonly event: string;
  readonly action: string | null;
  readonly installationId: number | null;
  readonly repository: { readonly id: number; readonly fullName: string } | null;
}

export type GithubWebhookOutcome = "applied" | "ignored";

// What a GitHub delivery changes here: an installation removed or suspended, a repository
// renamed. A push becomes a scan once scans exist (`WM6.5`); until then it is ignored.
export class HandleGithubWebhookUseCase {
  public constructor(
    private readonly installations: GithubInstallationRepository,
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(event: GithubWebhookEvent): Promise<GithubWebhookOutcome> {
    if (event.event === "installation" && event.installationId !== null) {
      switch (event.action) {
        case "deleted":
          await this.installations.remove(event.installationId);
          return "applied";
        case "suspend":
          await this.installations.setSuspended(event.installationId, this.clock.now());
          return "applied";
        case "unsuspend":
          await this.installations.setSuspended(event.installationId, null);
          return "applied";
        default:
          return "ignored";
      }
    }

    if (
      event.event === "repository" &&
      (event.action === "renamed" || event.action === "transferred") &&
      event.repository
    ) {
      await this.projects.renameRepository(
        "github",
        String(event.repository.id),
        event.repository.fullName,
      );
      return "applied";
    }

    return "ignored";
  }
}
