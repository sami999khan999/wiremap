import {
  and,
  eq,
  type OrganizationId,
  type Placement,
  sql,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { memberships, organizations, roles } from "../schema/index.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

// Both seeded by `SystemRoleSeed`. An organization missing either is one the seed never
// ran against, and enrolment declines rather than guesses.
const FOUNDER_ROLE = "owner";
const JOINER_ROLE = "member";

// An arbitrary but fixed namespace for `pg_advisory_xact_lock`'s two-argument form, so
// this lock can never collide with an advisory lock taken for some other reason.
const LOCK_NAMESPACE = 0x6c62_0001 | 0;

// Advisory locks are keyed on integers and an id is a uuid: eight hex digits are enough,
// since a collision costs two enrolments serialising anyway.
function lockKey(organizationId: string): number {
  return Number.parseInt(organizationId.replaceAll("-", "").slice(0, 8), 16) | 0;
}

// The `bootstrap` mode, and wrong for anything reachable from the internet: the sign-up
// form hands out membership of your tenant. See docs/reference/enrollers.md.
export class PgBootstrapMembershipEnroller extends BaseRepository {
  // RBAC, so the whole enrolment is one catalog transaction.
  protected override readonly placement: Placement = "catalog";

  // A constructor argument, not a setter: an enroller between construction and its
  // `withOrganizationSlug` call is one that silently enrols nobody.
  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    // `undefined` switches enrolment off entirely, which is the default: an unaffiliated
    // sign-up then gets no membership and the session is refused.
    private readonly organizationSlug: string | undefined,
  ) {
    super(cluster, scope, shards);
  }

  // Runs once per user, on the first session they ever open — `activeOrganizationFor`
  // answers on every one after that, so the queries below are not on the sign-in path.
  public async enrol(userId: UserId): Promise<OrganizationId | null> {
    const slug = this.organizationSlug;
    if (!slug) return null;

    const [organization] = await this.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    if (!organization) return null;
    const organizationId = organization.id;

    // Read-decide-write in one transaction behind an advisory lock: without it two racing
    // sign-ups both land as `owner`, which holds every tenant key.
    return this.cluster.catalog().client.transaction(async (tx) =>
      this.scope.within(tx, "catalog", async () => {
        await this.db.execute(
          sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${lockKey(organizationId)})`,
        );

        // Scoped to *this* organization, and checked inside the lock: unscoped, a user who
        // already belongs to any other tenant is handed that one back instead.
        const [existing] = await this.db
          .select({ organizationId: memberships.organizationId })
          .from(memberships)
          .where(
            and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)),
          )
          .limit(1);

        // Cast for the same reason `PgMembershipReader` casts: `memberships` declares
        // its FK as a plain `uuid`, and the brand lives on `organizations.id`.
        if (existing) return existing.organizationId as OrganizationId;

        const [occupant] = await this.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.organizationId, organizationId))
          .limit(1);

        const key = occupant ? JOINER_ROLE : FOUNDER_ROLE;

        const [role] = await this.db
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.organizationId, organizationId), eq(roles.key, key)))
          .limit(1);

        // The seed has not run against this organization. Declining is the only safe
        // answer: inventing a role here would be inventing a permission set.
        if (!role) return null;

        await this.db
          .insert(memberships)
          .values({ id: Uuid.v7(), organizationId, userId, roleId: role.id });

        return organizationId;
      }),
    );
  }
}
