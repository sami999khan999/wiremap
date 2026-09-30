import {
  and,
  asc,
  type ConversationId,
  type ConversationRepository,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  type NotificationRecipientReader,
  type OrganizationId,
  type PermissionKey,
  type Placement,
  type Recipient,
  type UserId,
} from "../../import.js";
import { BaseRepository, type DatabaseCluster } from "../primitive/index.js";
import { users } from "../schema/auth.schema.js";
import { memberships, rolePermissions } from "../schema/rbac.schema.js";
import type { ShardScope, TransactionScope } from "../transaction/index.js";

export class PgNotificationRecipientReader
  extends BaseRepository
  implements NotificationRecipientReader
{
  // Catalog, and now wholly so: the one routed read it had is `22.10`'s split.
  protected override readonly placement: Placement = "catalog";

  public constructor(
    cluster: DatabaseCluster,
    scope: TransactionScope,
    shards: ShardScope,
    // The routed half of `conversationMembers`, which this reader cannot query itself
    // — a repository has one placement, and that is the rule this split exists for.
    private readonly conversations: ConversationRepository,
  ) {
    super(cluster, scope, shards);
  }

  // Keyset on the user id, and tenant-scoped: a recipient list that cannot be narrowed
  // by organization is a cross-tenant leak with an email address attached.
  public async organizationMembers(
    organizationId: OrganizationId,
    holding: PermissionKey | null,
    limit: number,
    afterUserId: UserId | null,
  ): Promise<readonly Recipient[]> {
    const rows = await this.db
      .select({
        userId: memberships.userId,
        email: users.email,
        name: users.name,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          // A deactivated membership is somebody who cannot sign in. Mailing them is at
          // best noise and at worst a message about a tenant they were removed from.
          isNull(memberships.deactivatedAt),
          afterUserId ? gt(memberships.userId, afterUserId) : undefined,
          holding ? this.grants(organizationId, holding) : undefined,
        ),
      )
      .orderBy(asc(memberships.userId))
      .limit(limit);

    return rows.map((row) => PgNotificationRecipientReader.toRecipient(row));
  }

  // **Two statements, not one join.** `conversation_members` is routed and `users` and
  // `memberships` are catalog, so the single query this was had no plan across a split.
  public async conversationMembers(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    limit: number,
  ): Promise<readonly Recipient[]> {
    // The routed half, capped here rather than after the join: `limit` is a fan-out
    // ceiling, so a conversation past it is outside what this supports either way.
    const memberIds = await this.conversations.memberIds(organizationId, conversationId, limit);

    // The catalog half is `users`, already written, already one statement, and already
    // applying the `deactivatedAt` filter that keeps a removed member unnotified.
    const recipients = await this.users(organizationId, memberIds);

    return [...recipients].sort((left, right) => left.userId.localeCompare(right.userId));
  }

  public async user(organizationId: OrganizationId, userId: UserId): Promise<Recipient | null> {
    const [row] = await this.db
      .select({
        userId: memberships.userId,
        email: users.email,
        name: users.name,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          isNull(memberships.deactivatedAt),
        ),
      )
      .limit(1);

    return row ? PgNotificationRecipientReader.toRecipient(row) : null;
  }

  // One statement for a page of ids, because the digest resolves addresses per page and
  // one query per recipient is the shape that turns a fan-out into an outage.
  public async users(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<readonly Recipient[]> {
    if (userIds.length === 0) return [];

    const rows = await this.db
      .select({
        userId: memberships.userId,
        email: users.email,
        name: users.name,
        locale: users.locale,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.userId, [...userIds]),
          isNull(memberships.deactivatedAt),
        ),
      );

    return rows.map((row) => PgNotificationRecipientReader.toRecipient(row));
  }

  // A correlated `EXISTS` on the membership's role, which keeps the whole recipient
  // query one statement. See docs/reference/notification-recipients.md.
  private grants(organizationId: OrganizationId, permission: PermissionKey) {
    return exists(
      this.db
        .select({ present: rolePermissions.permission })
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.organizationId, organizationId),
            eq(rolePermissions.roleId, memberships.roleId),
            eq(rolePermissions.permission, permission),
          ),
        ),
    );
  }

  private static toRecipient(row: {
    userId: UserId;
    email: string;
    name: string;
    locale: string | null;
  }): Recipient {
    return {
      userId: row.userId,
      email: row.email,
      name: row.name,
      // An unrecognised value falls back rather than asking `ContentSource` for a
      // catalog that does not exist.
      locale: row.locale === "bn" ? "bn" : "en",
    };
  }
}
