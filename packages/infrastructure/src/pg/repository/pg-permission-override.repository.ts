import type {
  OrganizationId,
  OverrideInput,
  PermissionOverrideRecord,
  PermissionOverrideRepository,
  Placement,
  UserId,
} from "../../import.js";
import { and, asc, eq, gt, isNull, lte, or, sql, Uuid } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { permissionOverrides } from "../schema/index.js";

// Org-scope overrides as the screens and the sweep write them. Resolution reads the same
// table in `PgCapabilityRepository.explainFor`; this is the write side.
export class PgPermissionOverrideRepository
  extends BaseRepository
  implements PermissionOverrideRepository
{
  protected override readonly placement: Placement = "catalog";

  private static readonly ROW = {
    id: permissionOverrides.id,
    organizationId: permissionOverrides.organizationId,
    userId: permissionOverrides.userId,
    permission: permissionOverrides.permission,
    effect: permissionOverrides.effect,
    goalId: permissionOverrides.goalId,
    authority: permissionOverrides.authority,
    reason: permissionOverrides.reason,
    expiresAt: permissionOverrides.expiresAt,
    createdAt: permissionOverrides.createdAt,
  };

  // Live only, on `permission_overrides_user_idx`: an expired grant is not an exception.
  public async findFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly PermissionOverrideRecord[]> {
    const rows = await this.db
      .select(PgPermissionOverrideRepository.ROW)
      .from(permissionOverrides)
      .where(
        and(
          eq(permissionOverrides.organizationId, organizationId),
          eq(permissionOverrides.userId, userId),
          or(isNull(permissionOverrides.expiresAt), gt(permissionOverrides.expiresAt, sql`now()`)),
        ),
      )
      .orderBy(asc(permissionOverrides.permission), asc(permissionOverrides.authority));
    return rows.map((row) => PgPermissionOverrideRepository.record(row));
  }

  public async findById(
    organizationId: OrganizationId,
    id: string,
  ): Promise<PermissionOverrideRecord | null> {
    const rows = await this.db
      .select(PgPermissionOverrideRepository.ROW)
      .from(permissionOverrides)
      .where(
        and(eq(permissionOverrides.organizationId, organizationId), eq(permissionOverrides.id, id)),
      )
      .limit(1);
    return rows[0] ? PgPermissionOverrideRepository.record(rows[0]) : null;
  }

  // One statement for the whole closure, upserted on the org-scope unique index. A grant
  // replaces the org's deny of the key; the platform's row has its own authority and stays.
  public async save(
    organizationId: OrganizationId,
    userId: UserId,
    rows: readonly OverrideInput[],
    actor: UserId,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(permissionOverrides)
      .values(
        rows.map((row) => ({
          id: Uuid.v7(),
          organizationId,
          userId,
          goalId: null,
          permission: row.permission,
          effect: row.effect,
          reason: row.reason,
          expiresAt: row.expiresAt,
          authority: row.authority,
          createdBy: actor,
        })),
      )
      .onConflictDoUpdate({
        target: [
          permissionOverrides.organizationId,
          permissionOverrides.userId,
          permissionOverrides.permission,
          permissionOverrides.authority,
        ],
        targetWhere: sql`${permissionOverrides.goalId} is null`,
        set: {
          effect: sql`excluded.effect`,
          reason: sql`excluded.reason`,
          expiresAt: sql`excluded.expires_at`,
          createdBy: sql`excluded.created_by`,
          createdAt: sql`now()`,
        },
      });
  }

  public async delete(organizationId: OrganizationId, id: string): Promise<void> {
    await this.db
      .delete(permissionOverrides)
      .where(
        and(eq(permissionOverrides.organizationId, organizationId), eq(permissionOverrides.id, id)),
      );
  }

  // On the partial expiry index. Every org's, because the sweep is one pass for all.
  public async findExpired(now: Date): Promise<readonly PermissionOverrideRecord[]> {
    const rows = await this.db
      .select(PgPermissionOverrideRepository.ROW)
      .from(permissionOverrides)
      .where(lte(permissionOverrides.expiresAt, now));
    return rows.map((row) => PgPermissionOverrideRepository.record(row));
  }

  private static record(row: {
    id: string;
    organizationId: string;
    userId: UserId;
    permission: string;
    effect: "grant" | "deny";
    goalId: string | null;
    authority: "org" | "platform";
    reason: string | null;
    expiresAt: Date | null;
    createdAt: Date;
  }): PermissionOverrideRecord {
    return { ...row, organizationId: row.organizationId as OrganizationId };
  }
}
