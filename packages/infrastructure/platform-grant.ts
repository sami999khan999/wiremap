// The first platform admin, and the only way one exists. `GrantPermissionUseCase`
// refuses a key the granter does not hold — which is the right rule and means nobody
// can grant the first `platform.*` key through the API. Every later admin is invited
// through the members screen with the platform organization active.

import { and, eq, Uuid } from "./src/import.js";
import { Database } from "./src/pg/primitive/index.js";
import { memberships, organizations, roles, users } from "./src/pg/schema/index.js";
import { TransactionScope } from "./src/pg/transaction/index.js";

const ROLE_KEY = "platform_admin";

const email = process.argv[2];
if (!email) throw new Error("usage: pnpm platform:grant <email>");

// Direct, for the reason the migrator and the seed give: this runs once, by hand, and a
// transaction pooler is the wrong thing in front of it.
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is required.");

const database = new Database({ url });
const scope = new TransactionScope();

const outcome = await database.client.transaction(async (tx) =>
  // `catalog`: every table this touches is one — `users`, `organizations`, `roles`,
  // `memberships`. See `application/src/primitive/shard.ts`.
  scope.within(tx, "catalog", async () => {
    const [user] = await tx
      .select({ id: users.id, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.email, email));
    if (!user) throw new Error(`No user with email ${email}. They have to sign up first.`);

    // Loud, and before any write: a grant to a suspended account holds nothing, and would
    // look like success. This script is the recovery path when no admin is left (`AX6.9`).
    if (user.suspendedAt) {
      throw new Error(
        [
          `${email} is suspended by the platform (since ${user.suspendedAt.toISOString()}).`,
          "Reinstate them at /platform/accounts. With no platform admin left to do that, by hand:",
          `  UPDATE users SET suspended_at = NULL WHERE email = '${email}';`,
          "then run this again.",
        ].join("\n"),
      );
    }

    const [organization] = await tx
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.isPlatform, true))
      .limit(1);
    if (!organization)
      throw new Error("No organization is marked is_platform. Run `pnpm db:seed`.");

    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organization.id), eq(roles.key, ROLE_KEY)));
    if (!role)
      throw new Error(`No ${ROLE_KEY} role in ${organization.slug}. Run \`pnpm db:seed\`.`);

    const [existing] = await tx
      .select({ roleId: memberships.roleId })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organization.id), eq(memberships.userId, user.id)));

    // Already a member of the tier under some other role — a re-run after the role was
    // renamed, or somebody added by hand. Move them rather than failing on the unique.
    if (existing) {
      if (existing.roleId === role.id) return { action: "already", slug: organization.slug };

      await tx
        .update(memberships)
        .set({ roleId: role.id, deactivatedAt: null })
        .where(
          and(eq(memberships.organizationId, organization.id), eq(memberships.userId, user.id)),
        );

      return { action: "moved", slug: organization.slug };
    }

    await tx.insert(memberships).values({
      id: Uuid.v7(),
      organizationId: organization.id,
      userId: user.id,
      roleId: role.id,
    });

    return { action: "granted", slug: organization.slug };
  }),
);

await database.close();

// Says what it did rather than that it finished: "already" and "granted" are different
// answers to "why can this person not see /platform", and both look like success.
console.log(`${outcome.action}: ${email} is ${ROLE_KEY} in ${outcome.slug}`);
console.log("Their next request resolves it; the capability cache is 60 s at worst.");
