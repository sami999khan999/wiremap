import type { OrganizationId } from "../import.js";

export interface ProviderRepository {
  readonly externalId: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
}

export interface ProviderInstallation {
  readonly installationId: number;
  readonly accountLogin: string;
}

// The code host, behind a port: GitHub through its App today, GitLab or Bitbucket later as
// a second adapter. Read-only by construction; no method writes to a repository.
export abstract class RepositoryProvider {
  // False when this deployment has no App configured: projects can still take uploads.
  public abstract readonly configured: boolean;

  // Where to send someone to install the App for an organization. The organization rides in
  // a signed `state`, so the callback cannot be pointed at another tenant.
  public abstract installUrl(organizationId: OrganizationId): string | null;

  // The organization a callback's `state` was signed for, or null when it was tampered with.
  public abstract organizationFromState(state: string): OrganizationId | null;

  public abstract installation(installationId: number): Promise<ProviderInstallation | null>;

  // The installations the person who just installed can see, from the OAuth `code` GitHub
  // sends with the redirect. Null when the code is refused or no OAuth pair is configured.
  public abstract installationsOfUser(code: string): Promise<readonly number[] | null>;

  public abstract repositories(installationId: number): Promise<readonly ProviderRepository[]>;

  public abstract branches(installationId: number, fullName: string): Promise<readonly string[]>;

  // A read-only token for one repository, minted per use and never stored.
  public abstract readToken(
    installationId: number,
    fullName: string,
  ): Promise<{ readonly token: string; readonly expiresAt: Date }>;

  // One file's text at a ref, or null when it is absent or binary.
  public abstract fileAt(
    installationId: number,
    fullName: string,
    ref: string,
    path: string,
  ): Promise<string | null>;

  public abstract verifyWebhook(body: string, signature: string | null): boolean;
}
