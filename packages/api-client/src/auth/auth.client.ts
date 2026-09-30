import { createAuthClient, TwoFactorRequiredError, twoFactorClient } from "../import.js";
import { BetterAuthErrorNormalizer } from "./better-auth-error-normalizer.js";

export interface AuthClientConfig {
  readonly baseUrl: string;
}

// Exists for its return type: `ReturnType<typeof createAuthClient>` is the unconfigured
// client, so annotating with it erases `client.twoFactor`.
const createClient = (config: AuthClientConfig) =>
  createAuthClient({
    baseURL: config.baseUrl,
    plugins: [twoFactorClient()],
  });

export type BetterAuthClient = ReturnType<typeof createClient>;

// Everything an anonymous visitor can do, over Better Auth's **vanilla** client — never
// `better-auth/react`. See docs/reference/better-auth.md.
export class AuthClient {
  private readonly client: BetterAuthClient;

  public constructor(config: AuthClientConfig) {
    this.client = createClient(config);
  }

  // Throws an `AppError`, never a bare `Error`: `ErrorNormalizer` maps everything else to
  // `INTERNAL`, which makes every branch a caller writes on the code unreachable.
  public async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.client.signIn.email({ email, password });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);

    // **The fork is a success, not a failure**: Better Auth answers `200` with no `error`,
    // so only a throw stops the app navigating away from an incomplete sign-in.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true) {
      throw new TwoFactorRequiredError();
    }
  }

  // No session is issued: `autoSignIn` is off and verification is required, so success
  // means "go and read your email", not "you are in".
  public async signUp(
    name: string,
    email: string,
    password: string,
    callbackURL: string,
  ): Promise<void> {
    const { error } = await this.client.signUp.email({ name, email, password, callbackURL });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Resolves only if the redirect never happened, so an error here is a
  // misconfiguration rather than a user mistake.
  public async signInWithGoogle(callbackURL: string, errorCallbackURL: string): Promise<void> {
    const { error } = await this.client.signIn.social({
      provider: "google",
      callbackURL,
      errorCallbackURL,
    });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Throws like every other write here: `onDone` clears the cache, and clearing it after
  // a sign-out the server refused leaves a signed-in session behind a signed-out shell.
  public async signOut(): Promise<void> {
    const { error } = await this.client.signOut();
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // Deliberately resolves on a rejection too: an error distinguishable from success is an
  // oracle for which addresses are registered.
  public async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    await this.client.requestPasswordReset({ email, redirectTo });
  }

  public async resetPassword(token: string, newPassword: string): Promise<void> {
    const { error } = await this.client.resetPassword({ token, newPassword });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // The resend behind "did not get it?". Rate-limited to three a minute on the server,
  // because it is an unauthenticated endpoint that makes this deployment send mail.
  public async sendVerificationEmail(email: string, callbackURL: string): Promise<void> {
    const { error } = await this.client.sendVerificationEmail({ email, callbackURL });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  // ── the second leg of a sign-in that answered TWO_FACTOR_REQUIRED ──
  // Three alternatives, not a sequence, and all three throw on a bad code so a form uses
  // one error path.

  public async verifyTwoFactor(code: string): Promise<void> {
    const { error } = await this.client.twoFactor.verifyTotp({ code });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async verifyBackupCode(code: string): Promise<void> {
    const { error } = await this.client.twoFactor.verifyBackupCode({ code });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async sendTwoFactorOtp(): Promise<void> {
    const { error } = await this.client.twoFactor.sendOtp();
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async verifyTwoFactorOtp(code: string): Promise<void> {
    const { error } = await this.client.twoFactor.verifyOtp({ code });
    if (error) throw BetterAuthErrorNormalizer.normalize(error);
  }

  public async session() {
    const { data } = await this.client.getSession();
    return data ?? null;
  }

  public get raw(): BetterAuthClient {
    return this.client;
  }
}
