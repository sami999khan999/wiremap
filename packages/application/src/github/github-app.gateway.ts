import type { UserId } from "../import.js";

// What GitHub hands back once, when a manifest becomes an App. Plaintext: the caller
// encrypts it before anything is stored.
export interface GithubAppCredentials {
  readonly appId: string;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly privateKey: string;
  readonly webhookSecret: string;
}

// Registering an App from a manifest. See docs/infra/github-app.md.
export abstract class GithubAppGateway {
  // Where the manifest form posts, with a `state` signed for the person creating it.
  // `organization` is a GitHub organization's login; null is the person's own account.
  public abstract manifestAction(organization: string | null, userId: UserId): string;

  // The person a returning `state` was signed for, or null when it is forged or stale.
  public abstract userFromState(state: string): UserId | null;

  // The one-time `code` GitHub redirects back with, exchanged within the hour.
  public abstract convert(code: string): Promise<GithubAppCredentials>;
}
