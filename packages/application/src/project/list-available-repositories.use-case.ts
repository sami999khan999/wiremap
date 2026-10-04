import type { GithubInstallationRepository } from "../github/index.js";
import type { OrganizationId } from "../import.js";
import type { ProviderRepository, RepositoryProvider } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";

export interface AvailableRepository extends ProviderRepository {
  readonly installationId: number;
}

// Every repository the organization's installations can read. Read live from the provider:
// the installation's own repository list is the truth, and caching it would go stale.
export class ListAvailableRepositoriesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly installations: GithubInstallationRepository,
    private readonly provider: RepositoryProvider,
  ) {}

  public async execute(actor: Principal): Promise<readonly AvailableRepository[]> {
    this.authorizer.assert(actor, "project.create");
    return ListAvailableRepositoriesUseCase.read(
      this.installations,
      this.provider,
      actor.organizationId,
    );
  }

  // Shared with the writes that must check a repository is really the tenant's to add.
  public static async read(
    installations: GithubInstallationRepository,
    provider: RepositoryProvider,
    organizationId: OrganizationId,
  ): Promise<readonly AvailableRepository[]> {
    if (!(await provider.isConfigured())) return [];
    const bound = (await installations.list(organizationId)).filter(
      (installation) => !installation.suspended,
    );
    const lists = await Promise.all(
      bound.map(async (installation) =>
        (await provider.repositories(installation.installationId)).map((repository) => ({
          ...repository,
          installationId: installation.installationId,
        })),
      ),
    );
    return lists.flat();
  }
}
