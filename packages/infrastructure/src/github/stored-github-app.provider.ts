import {
  type GithubAppRepository,
  type OrganizationId,
  type ProviderInstallation,
  type ProviderRepository,
  RepositoryProvider,
  type SecretCipher,
} from "../import.js";
import { type GithubAppConfig, GithubAppProvider } from "./github-app.provider.js";
import { NullRepositoryProvider } from "./null-repository.provider.js";

export type StoredGithubAppOptions = Pick<
  GithubAppConfig,
  "stateSecret" | "apiUrl" | "oauthUrl" | "fetch"
>;

// The App made on the platform screen, read from the catalog while running, so a process
// that started before it existed picks it up without a restart. Every call resolves first.
export class StoredGithubAppProvider extends RepositoryProvider {
  private static readonly TTL_MS = 60_000;

  private readonly none = new NullRepositoryProvider();
  private held: { readonly provider: GithubAppProvider; readonly until: number } | null = null;

  public constructor(
    private readonly apps: GithubAppRepository,
    private readonly cipher: SecretCipher,
    private readonly options: StoredGithubAppOptions,
  ) {
    super();
  }

  public override async isConfigured(): Promise<boolean> {
    return (await this.current()).isConfigured();
  }

  public override async installUrl(organizationId: OrganizationId): Promise<string | null> {
    return (await this.current()).installUrl(organizationId);
  }

  public override async organizationFromState(state: string): Promise<OrganizationId | null> {
    return (await this.current()).organizationFromState(state);
  }

  public override async installation(installationId: number): Promise<ProviderInstallation | null> {
    return (await this.current()).installation(installationId);
  }

  public override async installationsOfUser(code: string): Promise<readonly number[] | null> {
    return (await this.current()).installationsOfUser(code);
  }

  public override async repositories(
    installationId: number,
  ): Promise<readonly ProviderRepository[]> {
    return (await this.current()).repositories(installationId);
  }

  public override async branches(
    installationId: number,
    fullName: string,
  ): Promise<readonly string[]> {
    return (await this.current()).branches(installationId, fullName);
  }

  public override async branchHead(
    installationId: number,
    fullName: string,
    branch: string,
  ): Promise<string | null> {
    return (await this.current()).branchHead(installationId, fullName, branch);
  }

  public override async readToken(
    installationId: number,
    fullName: string,
  ): Promise<{ readonly token: string; readonly expiresAt: Date }> {
    return (await this.current()).readToken(installationId, fullName);
  }

  public override async fileAt(
    installationId: number,
    fullName: string,
    ref: string,
    path: string,
  ): Promise<string | null> {
    return (await this.current()).fileAt(installationId, fullName, ref, path);
  }

  public override async verifyWebhook(body: string, signature: string | null): Promise<boolean> {
    return (await this.current()).verifyWebhook(body, signature);
  }

  // A found App is kept a minute. None is asked again on every call, so a just-made App
  // works at once in every process, and a removed one stops within the minute.
  private async current(): Promise<RepositoryProvider> {
    if (this.held && this.held.until > Date.now()) return this.held.provider;
    const record = await this.apps.find();
    if (!record) {
      this.held = null;
      return this.none;
    }
    const provider = new GithubAppProvider({
      ...this.options,
      appId: record.appId,
      slug: record.slug,
      privateKey: this.cipher.decrypt(record.encryptedPrivateKey),
      webhookSecret: this.cipher.decrypt(record.encryptedWebhookSecret),
      oauth: {
        clientId: record.clientId,
        clientSecret: this.cipher.decrypt(record.encryptedClientSecret),
      },
    });
    this.held = { provider, until: Date.now() + StoredGithubAppProvider.TTL_MS };
    return provider;
  }
}
