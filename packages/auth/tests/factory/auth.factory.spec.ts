import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/factory/auth.config.js";
import { AuthFactory } from "../../src/factory/auth.factory.js";
import type { CacheStore, Database, OrganizationId } from "../../src/import.js";
import { AuthMailer, type MailRecipient } from "../../src/mail/auth.mailer.js";
import { InvitationClaimer, type InvitationPreview } from "../../src/session/invitation.claimer.js";
import { MembershipEnroller } from "../../src/session/membership.enroller.js";
import { MembershipReader, type OrganizationSummary } from "../../src/session/membership.reader.js";
import { OrganizationFounder } from "../../src/session/organization.founder.js";

// Nothing here connects: this spec reads `auth.options` back, the only way to assert on
// configuration that has no behaviour until a request arrives.
const unreachable = (): never => {
  throw new Error("auth.factory.spec.ts inspects configuration only.");
};

const cache: CacheStore = {
  get: unreachable,
  set: unreachable,
  setIfAbsent: unreachable,
  delete: unreachable,
  deletePrefix: unreachable,
};

class StubMembershipReader extends MembershipReader {
  public override activeOrganizationFor(): Promise<OrganizationId | null> {
    return unreachable();
  }

  public override organizationsFor(): Promise<readonly OrganizationSummary[]> {
    return unreachable();
  }

  // Both were missing until the port grew a third method and nothing complained:
  // `tsconfig.json` includes `src/**` and not `tests/**`, so a stale double compiles.
  public override isActive(): Promise<boolean> {
    return unreachable();
  }

  public override ownedCount(): Promise<number> {
    return unreachable();
  }

  public override isSuspended(): Promise<boolean> {
    return unreachable();
  }
}

class StubMembershipEnroller extends MembershipEnroller {
  public override enrol(): Promise<OrganizationId | null> {
    return unreachable();
  }
}

class StubInvitationClaimer extends InvitationClaimer {
  public override preview(): Promise<InvitationPreview | null> {
    return unreachable();
  }

  public override claimByToken(): Promise<OrganizationId | null> {
    return unreachable();
  }

  public override claimPending(): Promise<OrganizationId | null> {
    return unreachable();
  }
}

class StubOrganizationFounder extends OrganizationFounder {
  public override found(): Promise<OrganizationId> {
    return unreachable();
  }
}

class StubAuthMailer extends AuthMailer {
  public override sendVerification(): Promise<void> {
    return unreachable();
  }

  public override sendPasswordReset(): Promise<void> {
    return unreachable();
  }

  public override sendTwoFactorOtp(): Promise<void> {
    return unreachable();
  }

  public override sendEmailChangeConfirmation(_to: MailRecipient, _url: string): Promise<void> {
    return unreachable();
  }
}

const BASE: AuthConfig = {
  secret: "inspect-only-inspect-only-inspect-only",
  baseUrl: "http://localhost:43000",
  trustedOrigins: ["http://localhost:43000"],
  sessionMaxAgeSeconds: 604_800,
  cookieCacheMaxAgeSeconds: 60,
  requireEmailVerification: true,
  appName: "Loadbearing",
  enrolmentMode: "personal",
  maxOwnedOrganizations: 10,
};

const optionsFor = (config: AuthConfig = BASE, mailer: AuthMailer = new StubAuthMailer()) =>
  AuthFactory.create(
    config,
    { client: {} } as unknown as Database,
    cache,
    new StubMembershipReader(),
    new StubMembershipEnroller(),
    mailer,
    new StubInvitationClaimer(),
    new StubOrganizationFounder(),
  ).options;

describe("AuthFactory — social providers", () => {
  // Absent rather than half-configured: an empty client id is rejected at Google's
  // consent screen, where no log line here can explain it.
  it("configures no provider when no credentials were supplied", () => {
    expect(optionsFor().socialProviders).toEqual({});
  });

  it("configures Google when both halves are present", () => {
    const options = optionsFor({
      ...BASE,
      google: { clientId: "id.apps.googleusercontent.com", clientSecret: "secret" },
    });

    expect(options.socialProviders?.google?.clientId).toBe("id.apps.googleusercontent.com");
  });

  // Without it Google reuses whichever account the browser is signed into, which reads
  // as a bug in this application rather than in the consent screen.
  it("always asks Google which account to use", () => {
    const options = optionsFor({ ...BASE, google: { clientId: "id", clientSecret: "secret" } });

    expect(options.socialProviders?.google?.prompt).toBe("select_account");
  });
});

describe("AuthFactory — account linking", () => {
  // Google asserts a verified address, so a match is the same person. The alternative is
  // telling a real user their email is taken by themselves.
  it("trusts Google and nothing else", () => {
    expect(optionsFor().account?.accountLinking?.trustedProviders).toEqual(["google"]);
  });

  // `requireLocalEmailVerified` defaults to true and is deliberately never set: false
  // lets someone pre-register at a victim's address and have their identity linked in.
  it("leaves the local-verification gate at its safe default", () => {
    expect("requireLocalEmailVerified" in (optionsFor().account?.accountLinking ?? {})).toBe(false);
  });
});

describe("AuthFactory — credential endpoints", () => {
  // Paths are Better Auth's own, read off the pinned runtime: a rule keyed on a path that
  // does not exist limits nothing and looks identical in review to one that works.
  it("rate-limits every endpoint that guesses a credential or sends mail", () => {
    const rules = optionsFor().rateLimit?.customRules ?? {};

    expect(Object.keys(rules).sort()).toEqual([
      "/invitation/accept",
      "/organization/create",
      "/organization/switch",
      "/request-password-reset",
      "/send-verification-email",
      "/sign-in/email",
      "/sign-up/email",
      "/two-factor/send-otp",
    ]);
  });

  it("requires a password at least twelve characters long", () => {
    expect(optionsFor().emailAndPassword?.minPasswordLength).toBe(12);
  });

  // Hashing is deliberately slow, so an unbounded password is a CPU exhaustion vector
  // on an endpoint anyone can reach.
  it("caps password length", () => {
    expect(optionsFor().emailAndPassword?.maxPasswordLength).toBe(128);
  });

  // Verification is required, so a session from the sign-up response would be a session
  // for an address nobody has proved they can read.
  it("issues no session from sign-up", () => {
    expect(optionsFor().emailAndPassword?.autoSignIn).toBe(false);
  });

  // Proving a mailbox was reachable is not proof that the person reading it is at this
  // browser — a link followed from a shared inbox must not sign anyone in.
  it("issues no session from following a verification link", () => {
    expect(optionsFor().emailVerification?.autoSignInAfterVerification).toBe(false);
  });

  // With this off the account exists, `emailVerified` stays false, and the only thing
  // that could clear it is never dispatched.
  it("sends the verification message on sign-up", () => {
    expect(optionsFor().emailVerification?.sendOnSignUp).toBe(true);
  });

  // The difference between changing a password and actually locking somebody out.
  it("revokes every session when a password is reset", () => {
    expect(optionsFor().emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });
});

describe("AuthFactory — two-factor", () => {
  // The label an authenticator app shows beside the code. Wrong here means every enrolled
  // device names the wrong product, and re-enrolment is the only fix.
  it("issues TOTP under the configured app name", () => {
    expect(optionsFor().appName).toBe("Loadbearing");
  });

  it("registers the two-factor plugin alongside bearer", () => {
    const ids = (optionsFor().plugins ?? []).map((plugin) => plugin.id);

    expect(ids).toContain("two-factor");
    expect(ids).toContain("bearer");
  });
});

describe("AuthFactory — organization plugin", () => {
  // The three paths the client calls and the rate-limit rules name. Read off the
  // plugin's endpoints so a renamed path fails here rather than as a 404 in the browser.
  it("mounts switch, create and accept as POST endpoints", () => {
    const plugin = (optionsFor().plugins ?? []).find(
      (candidate) => candidate.id === "organization",
    );
    // Not every plugin in the union declares `endpoints`, and the one being asked for is
    // the reason this fails if the plugin is ever renamed.
    const mounted = (plugin && "endpoints" in plugin ? plugin.endpoints : {}) as Record<
      string,
      { path: string; options: { method: string } }
    >;
    const endpoints = Object.values(mounted);

    expect(
      endpoints.map((endpoint) => `${endpoint.options.method} ${endpoint.path}`).sort(),
    ).toEqual([
      "POST /invitation/accept",
      "POST /organization/create",
      "POST /organization/switch",
    ]);
  });

  // Written by the plugin through `internalAdapter.updateUser`, which only knows the
  // fields declared here — a column that exists only in the Drizzle schema is invisible.
  it("declares the last-active organization as a user field the client cannot set", () => {
    const field = optionsFor().user?.additionalFields?.lastActiveOrganizationId;

    expect(field?.input).toBe(false);
  });
});

describe("AuthFactory — change of email", () => {
  // To the address being moved *away from*. Better Auth hands the new one to the same
  // callback, so getting it wrong is a single property access.
  it("confirms at the current address, never the new one", async () => {
    const sent: string[] = [];

    class RecordingMailer extends StubAuthMailer {
      public override sendEmailChangeConfirmation(to: MailRecipient): Promise<void> {
        sent.push(to.email);
        return Promise.resolve();
      }
    }

    const options = optionsFor(BASE, new RecordingMailer());

    await options.user?.changeEmail?.sendChangeEmailConfirmation?.({
      user: { id: "018f8c00-0000-7000-8000-000000000001", email: "old@example.com" },
      newEmail: "new@example.com",
      url: "https://example.test/callback",
      token: "token",
    } as never);

    expect(sent).toEqual(["old@example.com"]);
  });
});

describe("AuthFactory — a suspended account", () => {
  // The enroller is left unreachable on purpose: in bootstrap mode it hands a user with no
  // active membership their tenant back, which is how a suspend would open a session.
  it("refuses the session with ACCOUNT_SUSPENDED before any tenant is resolved", async () => {
    class SuspendedReader extends StubMembershipReader {
      public override isSuspended(): Promise<boolean> {
        return Promise.resolve(true);
      }
    }

    const options = AuthFactory.create(
      BASE,
      { client: {} } as unknown as Database,
      cache,
      new SuspendedReader(),
      new StubMembershipEnroller(),
      new StubAuthMailer(),
      new StubInvitationClaimer(),
      new StubOrganizationFounder(),
    ).options;

    const before = options.databaseHooks?.session?.create?.before;
    await expect(
      before?.({ userId: "018f8c00-0000-7000-8000-000000000001" } as never, null as never),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_SUSPENDED" } });
  });
});
