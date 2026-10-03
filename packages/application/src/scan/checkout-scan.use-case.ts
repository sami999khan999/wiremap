import type { Clock } from "../import.js";
import type { RepositoryProvider } from "../port/index.js";
import type { ProjectRepository } from "../project/index.js";
import type { ScanRepository } from "./scan.repository.js";
import { ScanProtocol } from "./scan-protocol.js";
import type { ScanRef } from "./scan-ref.js";
import type { ScanTokens } from "./scan-tokens.js";

export interface ScanCheckout {
  readonly repositories: readonly {
    readonly name: string;
    readonly fullName: string;
    readonly ref: string;
    // Read-only, this repository only, about an hour: never stored, and masked in the log.
    readonly token: string;
  }[];
  readonly ignore: readonly string[];
  readonly tsconfigPath: string | null;
}

// The runner's first call: what to clone, at which branch, with a token for each. The scan
// moves to running here, so a second checkout of the same scan is refused.
export class CheckoutScanUseCase {
  public constructor(
    private readonly tokens: ScanTokens,
    private readonly scans: ScanRepository,
    private readonly projects: ProjectRepository,
    private readonly provider: RepositoryProvider,
    private readonly clock: Clock,
  ) {}

  public async execute(ref: ScanRef, token: string | null): Promise<ScanCheckout> {
    const scan = await ScanProtocol.load(this.tokens, this.scans, ref, token, ["queued"]);
    const project = await this.projects.findById(ref.organizationId, scan.projectId);
    if (!project || !(await this.scans.start(ref.organizationId, scan.id, this.clock.now()))) {
      await this.scans.fail(
        ref.organizationId,
        scan.id,
        this.clock.now(),
        "The project no longer exists.",
      );
      return { repositories: [], ignore: [], tsconfigPath: null };
    }
    const repositories = [];
    for (const repository of project.repositories) {
      if (repository.provider !== "github" || repository.installationId === null) continue;
      const minted = await this.provider.readToken(repository.installationId, repository.fullName);
      repositories.push({
        name: repository.fullName.split("/").pop() ?? repository.fullName,
        fullName: repository.fullName,
        ref: scan.branch ?? repository.defaultBranch,
        token: minted.token,
      });
    }
    return { repositories, ignore: project.ignore, tsconfigPath: project.settings.tsconfigPath };
  }
}
