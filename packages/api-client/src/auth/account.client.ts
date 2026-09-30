import type { AuthClient, BetterAuthClient } from "./auth.client.js";
import { BetterAuthErrorNormalizer } from "./better-auth-error-normalizer.js";

// Handed back once, when enrolment is turned on. The codes are not readable again:
// `viewBackupCodes` is server-only and deliberately not reachable from here.
export interface TwoFactorEnrolment {
  readonly totpUri: string;
  readonly backupCodes: readonly string[];
}

// One of the ways this account can be signed into. `providerId` is `credential` for
// email and password, or the provider's own id for a social account.
export interface LinkedAccount {
  readonly id: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly createdAt: string;
}

// A live session, as the "where you are signed in" list renders it. `token` is what
// revoking takes, which is why this type never leaves the tab that fetched it.
export interface ActiveSession {
  readonly id: string;
  readonly token: string;
  readonly createdAt: string;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  // The one the tab is holding. Revoking it signs the reader out of the page they are
  // reading, which is what `revokeOtherSessions` exists to be instead.
  readonly current: boolean;
}

// Everything a signed-in person can do to their own account. Takes the `AuthClient`
// rather than a config, so there is one instance per tree.
export class AccountClient {
  private readonly client: BetterAuthClient;

  public constructor(auth: AuthClient) {
    this.client = auth.raw;
  }

  // ── credentials ──

  // `revokeOtherSessions` is not optional: changing a password because someone else may
  // know it, and leaving their session alive, is the failure this flow prevents.
  public async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { error } = await this.client.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Sends a confirmation to the address being moved *away from* — the server decides
  // that, not this call. Nothing changes until the link in that message is followed.
  public async changeEmail(newEmail: string, callbackURL: string): Promise<void> {
    const { error } = await this.client.changeEmail({ newEmail, callbackURL });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async updateName(name: string): Promise<void> {
    const { error } = await this.client.updateUser({ name });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // ── two-factor ──

  // The password stops a stolen session enrolling its own authenticator. Two-factor is
  // **not** on when this resolves — `verifyTotpEnrolment` is what turns it on.
  public async enableTwoFactor(password: string): Promise<TwoFactorEnrolment> {
    const { data, error } = await this.client.twoFactor.enable({ password });
    if (error || !data) throw BetterAuthErrorNormalizer.normalize(error);
    return { totpUri: data.totpURI, backupCodes: data.backupCodes };
  }

  public async verifyTotpEnrolment(code: string): Promise<void> {
    const { error } = await this.client.twoFactor.verifyTotp({ code });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async disableTwoFactor(password: string): Promise<void> {
    const { error } = await this.client.twoFactor.disable({ password });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Invalidates every previously issued code. The point of the flow, not a side effect.
  public async regenerateBackupCodes(password: string): Promise<readonly string[]> {
    const { data, error } = await this.client.twoFactor.generateBackupCodes({ password });
    if (error || !data) throw BetterAuthErrorNormalizer.normalize(error);
    return data.backupCodes;
  }

  // ── linked accounts ──

  public async listAccounts(): Promise<readonly LinkedAccount[]> {
    const { data, error } = await this.client.listAccounts();
    if (error || !data) throw BetterAuthErrorNormalizer.normalize(error);
    return data.map((account) => ({
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
      // A `Date` dehydrates to a string and rehydrates as one, so the type would be a
      // lie on the second render.
      createdAt: new Date(account.createdAt).toISOString(),
    }));
  }

  // Redirects to Google, like `signInWithGoogle`, and for the same reason resolves only
  // when it did not.
  public async linkGoogle(callbackURL: string): Promise<void> {
    const { error } = await this.client.linkSocial({ provider: "google", callbackURL });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // The caller decides whether this is allowed: only it can see the whole list. Better
  // Auth's `allowUnlinkingAll` stays at its default `false` as the backstop.
  public async unlinkAccount(providerId: string, accountId: string): Promise<void> {
    const { error } = await this.client.unlinkAccount({ providerId, accountId });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // ── sessions ──

  // Two calls, because the endpoint flags nothing and the cookie holding the current
  // token is httpOnly: this is the only place the two can be compared.
  public async listSessions(): Promise<readonly ActiveSession[]> {
    const [listed, current] = await Promise.all([
      this.client.listSessions(),
      this.client.getSession(),
    ]);

    const { data, error } = listed;
    if (error || !data) throw BetterAuthErrorNormalizer.normalize(error);

    const currentToken = current.data?.session?.token;

    return data.map((session) => ({
      id: session.id,
      token: session.token,
      createdAt: new Date(session.createdAt).toISOString(),
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
      // `undefined === token` is false for every row, so a session that cannot be
      // resolved marks none rather than marking all of them.
      current: session.token === currentToken,
    }));
  }

  public async revokeSession(token: string): Promise<void> {
    const { error } = await this.client.revokeSession({ token });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Every session but this one. The tab that calls it stays signed in, which is what
  // makes it usable from a settings page — `signOut` is the other button.
  public async revokeOtherSessions(): Promise<void> {
    const { error } = await this.client.revokeOtherSessions();
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }
}
