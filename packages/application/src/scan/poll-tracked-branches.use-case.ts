import type { OrganizationId, ProjectId } from "../import.js";
import type { CacheStore, RepositoryProvider } from "../port/index.js";
import type { ProjectRepository } from "../project/index.js";

export interface PollTarget {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly branch: string;
}

// Push-to-scan for a machine GitHub cannot reach: each hour, the head of every tracked
// branch is compared with the last one seen, and a branch that moved is scanned.
export class PollTrackedBranchesUseCase {
  // A head is kept a week: losing one costs a single extra scan, never a missed push.
  private static readonly HEAD_TTL = 7 * 24 * 3600;
  // Marked when a delivery arrives; while the mark lasts, webhooks do the job for that installation.
  private static readonly WEBHOOK_SEEN_TTL = 24 * 3600;

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly provider: RepositoryProvider,
    private readonly cache: CacheStore,
    private readonly enabled: boolean,
  ) {}

  public static webhookSeenKey(installationId: number): string {
    return `github:webhook-seen:${installationId}`;
  }

  // Called by the webhook route for every verified delivery that names an installation.
  public async webhookSeen(installationId: number): Promise<void> {
    await this.cache.set(
      PollTrackedBranchesUseCase.webhookSeenKey(installationId),
      true,
      PollTrackedBranchesUseCase.WEBHOOK_SEEN_TTL,
    );
  }

  // What to scan, one entry per project and branch. A head seen for the first time is only
  // recorded: the first tick after a start must not scan every project at once.
  public async due(): Promise<readonly PollTarget[]> {
    if (!this.enabled || !(await this.provider.isConfigured())) return [];
    const targets = new Map<string, PollTarget>();
    // Per installation: true when no webhook has arrived lately, so polling is its only signal.
    const polls = new Map<number, boolean>();
    for (const repository of await this.projects.polledRepositories()) {
      if (!polls.has(repository.installationId)) {
        const seen = await this.cache.get(
          PollTrackedBranchesUseCase.webhookSeenKey(repository.installationId),
        );
        polls.set(repository.installationId, seen === null);
      }
      if (!polls.get(repository.installationId)) continue;
      for (const branch of repository.branches) {
        // One repository failing (revoked, renamed, rate-limited) leaves the rest polled.
        const head = await this.provider
          .branchHead(repository.installationId, repository.fullName, branch)
          .catch(() => null);
        if (!head) continue;
        const key = `scan:head:${repository.repositoryId}:${branch}`;
        const previous = await this.cache.get<string>(key);
        await this.cache.set(key, head, PollTrackedBranchesUseCase.HEAD_TTL);
        if (previous !== null && previous !== head) {
          targets.set(`${repository.projectId}:${branch}`, {
            organizationId: repository.organizationId,
            projectId: repository.projectId,
            branch,
          });
        }
      }
    }
    return [...targets.values()];
  }
}
