import type { OrganizationId } from "../import.js";

export interface GithubInstallationRecord {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly suspended: boolean;
}

// Which GitHub App installations an organization has bound. Looked up by installation id
// from a webhook, which arrives holding no tenant.
export abstract class GithubInstallationRepository {
  public abstract list(
    organizationId: OrganizationId,
  ): Promise<readonly GithubInstallationRecord[]>;

  public abstract bind(
    organizationId: OrganizationId,
    installation: { readonly installationId: number; readonly accountLogin: string },
  ): Promise<void>;

  public abstract organizationsOf(installationId: number): Promise<readonly OrganizationId[]>;

  public abstract setSuspended(installationId: number, at: Date | null): Promise<void>;

  public abstract remove(installationId: number): Promise<void>;
}
