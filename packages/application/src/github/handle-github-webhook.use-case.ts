import type { Clock, OrganizationId, ProjectId } from "../import.js";
import type { ProjectRepository } from "../project/index.js";
import type { GithubInstallationRepository } from "./github-installation.repository.js";

// The fields read off a delivery, already parsed; everything else in the payload is ignored.
export interface GithubWebhookEvent {
  readonly event: string;
  readonly action: string | null;
  readonly installationId: number | null;
  readonly repository: { readonly id: number; readonly fullName: string } | null;
  // `refs/heads/main` on a push; anything else is not a branch and is not scanned.
  readonly ref?: string | null;
  readonly deleted?: boolean;
}

// A push names a repository and a branch; these are the projects it should scan. The caller
// queues each inside its tenant's placement, which this use-case cannot reach.
export interface PushTarget {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly branch: string;
}

export type GithubWebhookOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "ignored" }
  | { readonly kind: "push"; readonly targets: readonly PushTarget[] };

// What a GitHub delivery changes here: an installation removed or suspended, a repository
// renamed, and a push to a tracked branch, which the caller turns into scans.
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
          return { kind: "applied" };
        case "suspend":
          await this.installations.setSuspended(event.installationId, this.clock.now());
          return { kind: "applied" };
        case "unsuspend":
          await this.installations.setSuspended(event.installationId, null);
          return { kind: "applied" };
        default:
          return { kind: "ignored" };
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
      return { kind: "applied" };
    }

    if (
      event.event === "push" &&
      event.repository &&
      !event.deleted &&
      event.ref?.startsWith("refs/heads/")
    ) {
      const branch = event.ref.slice("refs/heads/".length);
      const tracking = await this.projects.trackingRepository(
        "github",
        String(event.repository.id),
      );
      const targets = tracking
        .filter((each) => each.branches.includes(branch))
        .map((each) => ({
          organizationId: each.organizationId,
          projectId: each.projectId,
          branch,
        }));
      return targets.length > 0 ? { kind: "push", targets } : { kind: "ignored" };
    }

    return { kind: "ignored" };
  }
}
