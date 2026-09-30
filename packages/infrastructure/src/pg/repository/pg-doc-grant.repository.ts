import type {
  DocGrantee,
  DocGrantKind,
  DocGrantRecord,
  DocGrantRepository,
  DocSpaceId,
  NewDocGrant,
  OrganizationId,
  Placement,
  UserId,
} from "../../import.js";
import { and, desc, eq, gt, isNull, or, sql } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { docSpaceGrants, organizations, plans, users } from "../schema/index.js";

// Catalog: the grants, and the three tables a grantee is named in, are all on node 0, so
// the label is a join here rather than a second read.
export class PgDocGrantRepository extends BaseRepository implements DocGrantRepository {
  protected override readonly placement: Placement = "catalog";

  public async list(spaceId: DocSpaceId): Promise<readonly DocGrantRecord[]> {
    const rows = await this.db
      .select({
        id: docSpaceGrants.id,
        spaceId: docSpaceGrants.spaceId,
        organizationId: docSpaceGrants.granteeOrganizationId,
        userId: docSpaceGrants.granteeUserId,
        planKey: docSpaceGrants.granteePlanKey,
        organizationName: organizations.name,
        userEmail: users.email,
        planName: plans.name,
        reason: docSpaceGrants.reason,
        expiresAt: docSpaceGrants.expiresAt,
        createdAt: docSpaceGrants.createdAt,
      })
      .from(docSpaceGrants)
      .leftJoin(organizations, eq(organizations.id, docSpaceGrants.granteeOrganizationId))
      .leftJoin(users, eq(users.id, docSpaceGrants.granteeUserId))
      .leftJoin(plans, eq(plans.key, docSpaceGrants.granteePlanKey))
      .where(eq(docSpaceGrants.spaceId, spaceId))
      .orderBy(desc(docSpaceGrants.createdAt));

    return rows.map((row) => {
      const kind: DocGrantKind = row.organizationId ? "organization" : row.userId ? "user" : "plan";
      const label = row.organizationName ?? row.userEmail ?? row.planName ?? row.planKey ?? "";
      return {
        id: row.id,
        spaceId: row.spaceId,
        kind,
        label,
        reason: row.reason,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      };
    });
  }

  public async findGrantee(kind: DocGrantKind, target: string): Promise<DocGrantee | null> {
    const term = target.trim();
    if (kind === "organization") {
      // A uuid literal compared to a slug fails to cast, so the id branch is only tried
      // when the term is shaped like one.
      const byId = /^[0-9a-f-]{36}$/i.test(term);
      const [row] = await this.db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          byId
            ? or(eq(organizations.id, term as OrganizationId), eq(organizations.slug, term))
            : eq(organizations.slug, term),
        )
        .limit(1);
      return row ? { kind, key: row.id, label: row.name } : null;
    }
    if (kind === "user") {
      const [row] = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(sql`lower(${users.email})`, term.toLowerCase()))
        .limit(1);
      return row ? { kind, key: row.id, label: row.email } : null;
    }
    const [row] = await this.db
      .select({ key: plans.key, name: plans.name })
      .from(plans)
      .where(eq(plans.key, term))
      .limit(1);
    return row ? { kind, key: row.key, label: row.name } : null;
  }

  // Replace rather than add: one grant per space and grantee is the rule the partial
  // unique indexes hold, and a second save is the operator changing the reason or expiry.
  public async save(grant: NewDocGrant): Promise<DocGrantRecord> {
    const column = PgDocGrantRepository.column(grant.grantee.kind);
    await this.db
      .delete(docSpaceGrants)
      .where(and(eq(docSpaceGrants.spaceId, grant.spaceId), eq(column, grant.grantee.key)));

    const [row] = await this.db
      .insert(docSpaceGrants)
      .values({
        id: grant.id,
        spaceId: grant.spaceId,
        granteeOrganizationId:
          grant.grantee.kind === "organization" ? (grant.grantee.key as OrganizationId) : null,
        granteeUserId: grant.grantee.kind === "user" ? (grant.grantee.key as UserId) : null,
        granteePlanKey: grant.grantee.kind === "plan" ? grant.grantee.key : null,
        reason: grant.reason,
        expiresAt: grant.expiresAt,
        createdBy: grant.createdBy,
      })
      .returning({ createdAt: docSpaceGrants.createdAt });

    return {
      id: grant.id,
      spaceId: grant.spaceId,
      kind: grant.grantee.kind,
      label: grant.grantee.label,
      reason: grant.reason,
      expiresAt: grant.expiresAt,
      createdAt: row?.createdAt ?? new Date(),
    };
  }

  public async delete(grantId: string): Promise<DocSpaceId | null> {
    const [row] = await this.db
      .delete(docSpaceGrants)
      .where(eq(docSpaceGrants.id, grantId))
      .returning({ spaceId: docSpaceGrants.spaceId });
    return row?.spaceId ?? null;
  }

  public async deleteBySpace(spaceId: DocSpaceId): Promise<void> {
    await this.db.delete(docSpaceGrants).where(eq(docSpaceGrants.spaceId, spaceId));
  }

  // One statement for all three routes in, the plan read through the organization in the
  // same query. Each branch is served by its own index.
  public async readableSpaceIds(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly DocSpaceId[]> {
    const rows = await this.db
      .selectDistinct({ spaceId: docSpaceGrants.spaceId })
      .from(docSpaceGrants)
      .where(
        and(
          or(isNull(docSpaceGrants.expiresAt), gt(docSpaceGrants.expiresAt, sql`now()`)),
          or(
            eq(docSpaceGrants.granteeOrganizationId, organizationId),
            eq(docSpaceGrants.granteeUserId, userId),
            eq(
              docSpaceGrants.granteePlanKey,
              sql`(select ${organizations.planKey} from ${organizations} where ${organizations.id} = ${organizationId})`,
            ),
          ),
        ),
      );
    return rows.map((row) => row.spaceId);
  }

  private static column(kind: DocGrantKind) {
    if (kind === "organization") return docSpaceGrants.granteeOrganizationId;
    if (kind === "user") return docSpaceGrants.granteeUserId;
    return docSpaceGrants.granteePlanKey;
  }
}
