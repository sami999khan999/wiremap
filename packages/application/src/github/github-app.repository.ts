// The deployment's one GitHub App, made from the platform screen. A singleton in the
// catalog: every tenant connects through the same App.
export interface GithubAppRecord {
  readonly appId: string;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string;
  readonly clientId: string;
  // `SecretCipher` output, all three. Decrypted only to build the provider.
  readonly encryptedPrivateKey: string;
  readonly encryptedWebhookSecret: string;
  readonly encryptedClientSecret: string;
}

export abstract class GithubAppRepository {
  public abstract find(): Promise<GithubAppRecord | null>;

  public abstract save(record: GithubAppRecord): Promise<void>;

  public abstract delete(): Promise<void>;
}
