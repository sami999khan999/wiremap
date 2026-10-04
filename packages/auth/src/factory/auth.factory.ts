import {
  APIError,
  type BetterAuthOptions,
  bearer,
  betterAuth,
  type CacheStore,
  type Database,
  drizzleAdapter,
  type Locale,
  Locales,
  Password,
  twoFactor,
  type UserId,
  Uuid,
} from "../import.js";
import type { AuthMailer, MailRecipient } from "../mail/index.js";
import { OrganizationPlugin } from "../plugin/index.js";
import type {
  InvitationClaimer,
  InvitationLinkClaimer,
  MembershipEnroller,
  MembershipReader,
  OrganizationFounder,
} from "../session/index.js";
import type { AuthConfig } from "./auth.config.js";

// Both, because the scheme differs by platform — shipping one produces an app that
// works for half your team. See docs/reference/auth-factory.md.
const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost"] as const;

const surfaceOf = (origin: string | null | undefined): "web" | "desktop" =>
  origin && DESKTOP_ORIGINS.some((allowed) => origin.startsWith(allowed)) ? "desktop" : "web";

// The one place Better Auth is configured. Every option is a security boundary or a
// surface that stops working — the argument for each is in docs/reference/auth-factory.md.
export class AuthFactory {
  private constructor() {}

  // No return annotation, and it has to stay that way: the two-factor plugin widens the
  // user type, so `ReturnType<typeof betterAuth>` fails to assign.
  public static create(
    config: AuthConfig,
    database: Database,
    cache: CacheStore,
    memberships: MembershipReader,
    enroller: MembershipEnroller,
    mailer: AuthMailer,
    claimer: InvitationClaimer,
    founder: OrganizationFounder,
    linkClaimer: InvitationLinkClaimer,
  ) {
    const options = {
      secret: config.secret,
      baseURL: config.baseUrl,
      trustedOrigins: [...config.trustedOrigins],
      appName: config.appName,

      database: drizzleAdapter(database.client, { provider: "pg" }),

      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) =>
          mailer.sendPasswordReset(AuthFactory.recipient(user), url),
        minPasswordLength: Password.MIN_LENGTH,
        maxPasswordLength: Password.MAX_LENGTH,
        autoSignIn: false,
        resetPasswordTokenExpiresIn: 3600,
      },

      // Paired with requireEmailVerification.
      emailVerification: {
        sendVerificationEmail: async ({ user, url }) =>
          mailer.sendVerification(AuthFactory.recipient(user), url),
        sendOnSignUp: false,
        autoSignInAfterVerification: false,
        expiresIn: 3600,
      },

      // ── model naming ───────────────────────────────────────────────────────
      // `modelName` is what the Drizzle adapter looks up, so these five names *are* the
      // exports in packages/infrastructure/src/pg/schema/auth.schema.ts.

      user: {
        modelName: "users",
        additionalFields: {
          locale: { type: "string", required: false, defaultValue: "en" },
          timezone: { type: "string", required: false },
          suspendedAt: { type: "date", required: false, input: false },
          // Written by the organization plugin through `internalAdapter.updateUser`,
          // which is why it must be declared here and not only in the Drizzle schema.
          lastActiveOrganizationId: { type: "string", required: false, input: false },
        },

        changeEmail: {
          enabled: true,
          sendChangeEmailConfirmation: async ({ user, url }) =>
            mailer.sendEmailChangeConfirmation(AuthFactory.recipient(user), url),
        },
      },

      account: {
        modelName: "accounts",
        accountLinking: {
          enabled: true,
          trustedProviders: ["google", "github"],
        },
      },

      // Absent rather than half-configured — and absence is what lets the sign-in page
      // decide whether to render the button.
      socialProviders: {
        ...(config.google
          ? {
              google: {
                clientId: config.google.clientId,
                clientSecret: config.google.clientSecret,
                prompt: "select_account" as const,
              },
            }
          : {}),
        ...(config.github
          ? {
              github: {
                clientId: config.github.clientId,
                clientSecret: config.github.clientSecret,
              },
            }
          : {}),
      },

      session: {
        modelName: "sessions",
        expiresIn: config.sessionMaxAgeSeconds,
        updateAge: Math.floor(config.sessionMaxAgeSeconds / 4),

        // Not a default. Without it, secondary storage puts the authoritative session on
        // the `allkeys-lru` instance, where an eviction is a random sign-out.
        storeSessionInDatabase: true,

        // Most requests skip the session lookup. The window is a revocation window —
        // `env.ts` caps it at 60.
        cookieCache: {
          enabled: true,
          maxAge: config.cookieCacheMaxAgeSeconds,
        },

        // `input: false` is what stops a sign-up body naming its own tenant or claiming
        // a surface. Both are pinned at sign-in.
        additionalFields: {
          activeOrganizationId: { type: "string", required: true, input: false },
          surface: { type: "string", required: true, input: false },
        },
      },

      // The same trap as `storeSessionInDatabase`: without it, reset and verification
      // tokens live in Redis only, and an eviction breaks a link with no error.
      verification: {
        modelName: "verifications",
        storeInDatabase: true,
      },

      advanced: {
        // User-visible, and changing it later invalidates every cookie already issued.
        cookiePrefix: "app",
        // Time-ordered uuids, so `UserId` — `z.uuid().brand<"UserId">()` — is true
        // rather than aspirational. Better Auth's default is an opaque string.
        database: { generateId: (): string => Uuid.v7() },
        defaultCookieAttributes: {
          httpOnly: true,
          sameSite: "lax",
          secure: config.baseUrl.startsWith("https://"),
        },
      },

      rateLimit: {
        enabled: true,
        window: 60,
        max: 20,
        // A lost counter means a few extra attempts, never a lockout — which is why
        // eviction is acceptable here and not for sessions.
        storage: "secondary-storage",

        // Twenty a minute is for endpoints nobody attacks. Paths are Better Auth's own
        // and verified against the pinned runtime: an unknown path limits nothing.
        customRules: {
          "/sign-in/email": { window: 60, max: 10 },
          "/sign-up/email": { window: 60, max: 5 },
          "/request-password-reset": { window: 60, max: 3 },
          "/send-verification-email": { window: 60, max: 3 },
          "/two-factor/send-otp": { window: 60, max: 3 },
          "/organization/create": { window: 60, max: 5 },
          "/invitation/accept": { window: 60, max: 5 },
          "/invitation-link/accept": { window: 60, max: 5 },
          "/organization/switch": { window: 60, max: 20 },
        },
      },

      // Redis in FRONT of Postgres, never instead of it: anything here can vanish under
      // memory pressure, and Better Auth reads through to `sessions` on a miss.
      secondaryStorage: {
        get: async (key) => cache.get<string>(`auth:${key}`),
        set: async (key, value, ttl) => cache.set(`auth:${key}`, value, ttl ?? 300),
        delete: async (key) => cache.delete(`auth:${key}`),
      },

      databaseHooks: {
        user: {
          create: {
            before: async (user) => ({
              data: {
                ...user,
                emailVerified: true,
              },
            }),
          },
        },
        session: {
          create: {
            // Resolves the tenant once, at sign-in. Returning `false` aborts the session,
            // so no membership means a failed sign-in, not an unscoped principal.
            before: async (session, context) => {
              const userId = session.userId as UserId;

              // Thrown, not `false`: the password was right, so saying why costs nothing.
              // Before `enrol` too, which would otherwise hand the bootstrap tenant back.
              if (await memberships.isSuspended(userId)) {
                throw new APIError("FORBIDDEN", {
                  code: "ACCOUNT_SUSPENDED",
                  message: "This account has been suspended.",
                });
              }

              // Not a `user.create.after` hook: Better Auth queues those until the whole
              // sign-up endpoint has finished, which is after this one has refused.
              const organizationId =
                (await memberships.activeOrganizationFor(userId)) ?? (await enroller.enrol(userId));

              if (!organizationId) return false;

              const origin = context?.request?.headers.get("origin") ?? null;
              return {
                data: {
                  ...session,
                  activeOrganizationId: organizationId,
                  surface: surfaceOf(origin),
                },
              };
            },
          },
        },
      },

      // Bearer is not optional: the Tauri webview is cross-origin, and a session cookie
      // is never sent cross-origin.
      plugins: [
        bearer(),
        twoFactor({
          schema: { twoFactor: { modelName: "twoFactors" } },
          issuer: config.appName,
          backupCodeOptions: { amount: 10, length: 10 },
          otpOptions: {
            // **Minutes, not seconds** — Better Auth's default is 3. Longer widens the
            // window in which a forwarded message is still a valid second factor.
            period: 5,
            sendOTP: async ({ user, otp }) =>
              mailer.sendTwoFactorOtp(AuthFactory.recipient(user), otp),
          },
        }),
        // Switch, create, accept — the three ways a session ends up pointing at a
        // different tenant. See the class for why they are endpoints, not procedures.
        OrganizationPlugin.create(
          memberships,
          claimer,
          founder,
          config.maxOwnedOrganizations,
          linkClaimer,
        ),
      ],
    } satisfies BetterAuthOptions;

    return betterAuth(options);
  }

  // Better Auth hands these hooks its own user, whose `locale` is an additional field and
  // therefore typed loosely. An unrecognised value falls back rather than rendering blank.
  private static recipient(user: { id: string; email: string; locale?: unknown }): MailRecipient {
    return {
      email: user.email,
      userId: user.id as UserId,
      locale: AuthFactory.localeOf(user.locale),
    };
  }

  private static localeOf(value: unknown): Locale {
    return Locales.ALL.find((locale) => locale === value) ?? Locales.DEFAULT;
  }
}

// What every consumer names: `BetterAuthSessionResolver` takes one, `Container` holds one.
export type AuthInstance = ReturnType<typeof AuthFactory.create>;
