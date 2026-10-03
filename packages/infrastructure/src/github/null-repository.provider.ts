import {
  type OrganizationId,
  type ProviderInstallation,
  type ProviderRepository,
  RepositoryProvider,
  UnavailableError,
} from "../import.js";

// No App configured: projects still take uploads, and nothing pretends to reach GitHub.
export class NullRepositoryProvider extends RepositoryProvider {
  public override readonly configured = false;

  public override installUrl(_organizationId: OrganizationId): null {
    return null;
  }

  public override organizationFromState(_state: string): null {
    return null;
  }

  public override installation(_installationId: number): Promise<ProviderInstallation | null> {
    return Promise.resolve(null);
  }

  public override branchHead(): Promise<string | null> {
    return Promise.resolve(null);
  }

  public override installationsOfUser(_code: string): Promise<readonly number[] | null> {
    return Promise.resolve(null);
  }

  public override repositories(_installationId: number): Promise<readonly ProviderRepository[]> {
    return Promise.resolve([]);
  }

  public override branches(_installationId: number, _fullName: string): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  public override readToken(): Promise<{ readonly token: string; readonly expiresAt: Date }> {
    return Promise.reject(new UnavailableError("github"));
  }

  public override fileAt(): Promise<string | null> {
    return Promise.resolve(null);
  }

  public override verifyWebhook(_body: string, _signature: string | null): boolean {
    return false;
  }
}
