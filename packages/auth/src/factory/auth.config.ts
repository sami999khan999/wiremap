// Every value comes from the environment through `ContainerConfig`. None are literals
// here: burying an operational decision in a factory makes it a deploy, not a variable.
export interface AuthConfig {
  readonly secret: string;
  readonly baseUrl: string;
  // The CSRF defence, and the same list the CORS allowlist reads. Explicit, never a
  // wildcard, and carrying both Tauri origins.
  readonly trustedOrigins: readonly string[];
  readonly sessionMaxAgeSeconds: number;
  // The revocation window: a session is only re-checked when this expires, which is why
  // `env.ts` caps it. See docs/reference/capability-cache.md.
  readonly cookieCacheMaxAgeSeconds: number;
  readonly requireEmailVerification: boolean;
  // What an authenticator app displays beside a TOTP code. Changing it after anyone has
  // enrolled leaves their authenticator naming a product that no longer exists.
  readonly appName: string;
  // How a brand-new user acquires the membership without which no session is issued.
  // `Container` binds one of three enrollers — see docs/reference/enrolment.md.
  readonly enrolmentMode: "personal" | "bootstrap" | "invite";
  // Undefined switches Google sign-in off rather than half-configuring it: an empty
  // client id is rejected at the consent screen, where no log line explains it.
  readonly google?: { readonly clientId: string; readonly clientSecret: string };
  // Wiremap: the GitHub App's OAuth credentials, the same pair rule as Google's.
  readonly github?: { readonly clientId: string; readonly clientSecret: string };
  // Required when `enrolmentMode` is `bootstrap` and ignored otherwise. The same slug
  // `pnpm db:seed` creates, which is what stops the two drifting.
  readonly bootstrapOrganizationSlug?: string;
  // How many tenants one person may found. A rate limit bounds the rate and not the
  // total — see docs/reference/organization-plugin.md.
  readonly maxOwnedOrganizations: number;
}
