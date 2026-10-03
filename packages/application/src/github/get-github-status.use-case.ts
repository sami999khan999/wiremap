import type { RepositoryProvider } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type {
  GithubInstallationRecord,
  GithubInstallationRepository,
} from "./github-installation.repository.js";

export interface GithubStatus {
  readonly installUrl: string | null;
  readonly installations: readonly GithubInstallationRecord[];
}

export class GetGithubStatusUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly installations: GithubInstallationRepository,
    private readonly provider: RepositoryProvider,
  ) {}

  public async execute(actor: Principal): Promise<GithubStatus> {
    this.authorizer.assert(actor, "project.create");
    return {
      installUrl: this.provider.installUrl(actor.organizationId),
      installations: await this.installations.list(actor.organizationId),
    };
  }
}
