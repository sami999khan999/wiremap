import { AuthFactory } from "./src/factory/index.js";
import { type CacheStore, Database, getSchema, type OrganizationId } from "./src/import.js";
import { AuthMailer } from "./src/mail/index.js";
import {
  InvitationClaimer,
  type InvitationPreview,
  MembershipEnroller,
  MembershipReader,
  OrganizationFounder,
  type OrganizationSummary,
} from "./src/session/index.js";

// Better Auth's own tables, printed from the pinned runtime rather than by
// `@better-auth/cli`, which trails the library. Diff against pg/schema/auth.schema.ts.

const url = process.env.DATABASE_URL ?? "postgres://unused:unused@localhost:45432/unused";

const unreachable = (): never => {
  throw new Error("auth.tables.ts inspects configuration only.");
};

const cache: CacheStore = {
  get: unreachable,
  set: unreachable,
  setIfAbsent: unreachable,
  delete: unreachable,
  deletePrefix: unreachable,
};

class UnusedMembershipReader extends MembershipReader {
  // Not `async`: there is nothing to await, and `never` satisfies the port's return type.
  public override activeOrganizationFor(): Promise<OrganizationId | null> {
    return unreachable();
  }

  public override organizationsFor(): Promise<readonly OrganizationSummary[]> {
    return unreachable();
  }

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

class UnusedMembershipEnroller extends MembershipEnroller {
  public override enrol(): Promise<OrganizationId | null> {
    return unreachable();
  }
}

class UnusedAuthMailer extends AuthMailer {
  public override sendVerification(): Promise<void> {
    return unreachable();
  }

  public override sendPasswordReset(): Promise<void> {
    return unreachable();
  }

  public override sendTwoFactorOtp(): Promise<void> {
    return unreachable();
  }

  public override sendEmailChangeConfirmation(): Promise<void> {
    return unreachable();
  }
}

class UnusedInvitationClaimer extends InvitationClaimer {
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

class UnusedOrganizationFounder extends OrganizationFounder {
  public override found(): Promise<OrganizationId> {
    return unreachable();
  }
}

// Through `AuthFactory`, never a second copy of the options: a restated `plugins` or
// `additionalFields` would describe an auth instance that does not exist.
const auth = AuthFactory.create(
  {
    secret: "inspect-only-inspect-only-inspect-only",
    baseUrl: "http://localhost:43000",
    trustedOrigins: [],
    sessionMaxAgeSeconds: 604_800,
    cookieCacheMaxAgeSeconds: 60,
    requireEmailVerification: true,
    appName: "Inspect",
    // The mode changes nothing about the schema — no enroller runs here — but the type
    // is closed, so stating it is how this script keeps compiling against the real config.
    enrolmentMode: "invite" as const,
    // Any positive number: no endpoint runs here, and the schema does not depend on it.
    maxOwnedOrganizations: 10,
    // Google deliberately absent: the provider adds no table, and supplying credentials
    // to a script anyone runs by hand is how a secret ends up in a shell history.
  },
  new Database({ url }),
  cache,
  new UnusedMembershipReader(),
  new UnusedMembershipEnroller(),
  new UnusedAuthMailer(),
  new UnusedInvitationClaimer(),
  new UnusedOrganizationFounder(),
);

for (const [model, table] of Object.entries(getSchema(auth.options))) {
  console.log(`\n${model}`);

  for (const [field, attribute] of Object.entries(table.fields)) {
    const flags = [
      attribute.required ? "required" : "nullable",
      ...(attribute.unique ? ["unique"] : []),
      ...(attribute.defaultValue !== undefined ? ["default"] : []),
      ...(attribute.references
        ? [`→ ${attribute.references.model}.${attribute.references.field}`]
        : []),
    ];
    console.log(`  ${field.padEnd(24)} ${String(attribute.type).padEnd(10)} ${flags.join(" ")}`);
  }
}
