import { ForbiddenError, NotFoundError } from "../import.js";
import type { ActivityLogger, RepositoryProvider, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { GithubInstallationRepository } from "./github-installation.repository.js";

export interface BindGithubInstallationInput {
  readonly installationId: number;
  readonly state: string;
}

// The App's setup callback: GitHub sends the person back with the installation id and the
// `state` we signed. Both the state and the person's own organization must agree.
export class BindGithubInstallationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly installations: GithubInstallationRepository,
    private readonly provider: RepositoryProvider,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: BindGithubInstallationInput): Promise<void> {
    this.authorizer.assert(actor, "project.create");

    // A state signed for another tenant is someone else's install link replayed.
    if (this.provider.organizationFromState(input.state) !== actor.organizationId) {
      throw new ForbiddenError("project.create");
    }

    const installation = await this.provider.installation(input.installationId);
    if (!installation) throw new NotFoundError("githubInstallation", String(input.installationId));

    await this.unitOfWork.run(async () => {
      await this.installations.bind(actor.organizationId, installation);
      await this.activity.record(actor, "github.installation.bound", {
        installationId: installation.installationId,
        account: installation.accountLogin,
      });
    });
  }
}
