import {
  and,
  eq,
  inArray,
  type OrganizationId,
  type Placement,
  type UserId,
  type UserReader,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { users } from "../schema/auth.schema.js";
import { memberships } from "../schema/rbac.schema.js";

export class PgUserReader extends BaseRepository implements UserReader {
  // Both tables are catalog. The ids this resolves come from routed rows, which is why
  // the caller reads them first and hands them over rather than asking for a join.
  protected override readonly placement: Placement = "catalog";

  public async namesOf(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>> {
    // No statement for an empty set: `IN ()` is a syntax error in Postgres and drizzle
    // renders it as `false`, which is a query that can only ever return nothing.
    if (userIds.length === 0) return new Map();

    // Through `memberships`, so an id from another tenant resolves to nothing. And no
    // `deactivatedAt` filter: someone who has left still wrote the messages above.
    const rows = await this.db
      .select({ userId: memberships.userId, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.userId, [...new Set(userIds)]),
        ),
      );

    return new Map(rows.map((row) => [row.userId, row.name]));
  }
}
