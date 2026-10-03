import {
  and,
  asc,
  eq,
  type GithubInstallationRecord,
  type GithubInstallationRepository,
  type OrganizationId,
  type Placement,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { githubInstallations } from "../schema/index.js";

export class PgGithubInstallationRepository
  extends BaseRepository
  implements GithubInstallationRepository
{
  protected override readonly placement: Placement = "catalog";

  public async list(organizationId: OrganizationId): Promise<readonly GithubInstallationRecord[]> {
    const rows = await this.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.organizationId, organizationId))
      .orderBy(asc(githubInstallations.accountLogin));
    return rows.map((row) => ({
      installationId: row.installationId,
      accountLogin: row.accountLogin,
      suspended: row.suspendedAt !== null,
    }));
  }

  public async bind(
    organizationId: OrganizationId,
    installation: { readonly installationId: number; readonly accountLogin: string },
  ): Promise<void> {
    await this.db
      .insert(githubInstallations)
      .values({ organizationId, ...installation })
      .onConflictDoUpdate({
        target: [githubInstallations.organizationId, githubInstallations.installationId],
        set: { accountLogin: installation.accountLogin, suspendedAt: null },
      });
  }

  // Across tenants, on `github_installations_installation_idx`: a webhook names an
  // installation and no organization.
  public async organizationsOf(installationId: number): Promise<readonly OrganizationId[]> {
    const rows = await this.db
      .select({ organizationId: githubInstallations.organizationId })
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId));
    return rows.map((row) => row.organizationId);
  }

  public async setSuspended(installationId: number, at: Date | null): Promise<void> {
    await this.db
      .update(githubInstallations)
      .set({ suspendedAt: at })
      .where(and(eq(githubInstallations.installationId, installationId)));
  }

  public async remove(installationId: number): Promise<void> {
    await this.db
      .delete(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId));
  }
}
