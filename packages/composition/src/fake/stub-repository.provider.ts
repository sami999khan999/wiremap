import {
  type OrganizationId,
  type ProviderInstallation,
  type ProviderRepository,
  RepositoryProvider,
} from "../import.js";

// A code host with a fixed list of repositories and files, never a network call. The
// install `state` is the organization id itself, so a spec can forge one on purpose.
export class StubRepositoryProvider extends RepositoryProvider {
  public constructor(
    private readonly available: readonly ProviderRepository[] = [],
    private readonly files: Readonly<Record<string, string>> = {},
  ) {
    super();
  }

  public override isConfigured(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public override installUrl(organizationId: OrganizationId): Promise<string> {
    return Promise.resolve(
      `https://github.test/apps/stub/installations/new?state=${organizationId}`,
    );
  }

  public override organizationFromState(state: string): Promise<OrganizationId | null> {
    return Promise.resolve(state === "" ? null : (state as OrganizationId));
  }

  public override installation(installationId: number): Promise<ProviderInstallation | null> {
    return Promise.resolve({ installationId, accountLogin: "stub" });
  }

  // Sees no installation: binding through the stub always needs a real provider's proof.
  public override branchHead(): Promise<string | null> {
    return Promise.resolve(null);
  }

  public override installationsOfUser(_code: string): Promise<readonly number[] | null> {
    return Promise.resolve(null);
  }

  public override repositories(): Promise<readonly ProviderRepository[]> {
    return Promise.resolve(this.available);
  }

  public override branches(): Promise<readonly string[]> {
    return Promise.resolve(["main"]);
  }

  public override readToken(): Promise<{ readonly token: string; readonly expiresAt: Date }> {
    return Promise.resolve({ token: "stub-token", expiresAt: new Date(0) });
  }

  public override fileAt(
    _installationId: number,
    fullName: string,
    ref: string,
    path: string,
  ): Promise<string | null> {
    return Promise.resolve(this.files[`${fullName}@${ref}:${path}`] ?? null);
  }

  public override verifyWebhook(_body: string, signature: string | null): Promise<boolean> {
    return Promise.resolve(signature === "valid");
  }
}
