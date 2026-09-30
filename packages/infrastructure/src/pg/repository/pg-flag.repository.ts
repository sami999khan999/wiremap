import type {
  FlagRecord,
  FlagRepository,
  FlagTarget,
  OrganizationId,
  Placement,
  UserId,
} from "../../import.js";
import { and, asc, eq } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { featureFlagOrganizations, featureFlags, organizations } from "../schema/index.js";

// Deployment-wide switches. Every read is the whole state: a handful of rows, cached
// under one key by `FlagCache`, so a per-org query would be a second round trip for nothing.
export class PgFlagRepository extends BaseRepository implements FlagRepository {
  protected override readonly placement: Placement = "catalog";

  // One statement. A flag with no targets comes back once with a null target, which is
  // why both joins are left joins.
  public async findAll(): Promise<readonly FlagRecord[]> {
    const rows = await this.db
      .select({
        key: featureFlags.key,
        isEnabled: featureFlags.isEnabled,
        updatedAt: featureFlags.updatedAt,
        organizationId: featureFlagOrganizations.organizationId,
        slug: organizations.slug,
      })
      .from(featureFlags)
      .leftJoin(featureFlagOrganizations, eq(featureFlagOrganizations.flagKey, featureFlags.key))
      .leftJoin(organizations, eq(organizations.id, featureFlagOrganizations.organizationId))
      .orderBy(asc(featureFlags.key), asc(organizations.slug));

    const byKey = new Map<string, { record: Omit<FlagRecord, "targets">; targets: FlagTarget[] }>();
    for (const row of rows) {
      const entry = byKey.get(row.key) ?? {
        record: { key: row.key, isEnabled: row.isEnabled, updatedAt: row.updatedAt },
        targets: [],
      };
      if (row.organizationId && row.slug) {
        entry.targets.push({
          organizationId: row.organizationId,
          slug: row.slug,
        });
      }
      byKey.set(row.key, entry);
    }

    return [...byKey.values()].map(({ record, targets }) => ({ ...record, targets }));
  }

  public async save(key: string, isEnabled: boolean, actor: UserId): Promise<void> {
    const now = new Date();
    await this.db
      .insert(featureFlags)
      .values({ key, isEnabled, updatedBy: actor, updatedAt: now })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { isEnabled, updatedBy: actor, updatedAt: now },
      });
  }

  // The flag row first, off: a target is a foreign key into it, and the first targeted
  // rollout of a new flag is exactly the case with no row yet.
  public async saveTarget(
    key: string,
    organizationId: OrganizationId,
    actor: UserId,
  ): Promise<void> {
    await this.db.insert(featureFlags).values({ key, updatedBy: actor }).onConflictDoNothing();
    await this.db
      .insert(featureFlagOrganizations)
      .values({ organizationId, flagKey: key, createdBy: actor })
      .onConflictDoNothing();
  }

  public async deleteTarget(key: string, organizationId: OrganizationId): Promise<void> {
    await this.db
      .delete(featureFlagOrganizations)
      .where(
        and(
          eq(featureFlagOrganizations.organizationId, organizationId),
          eq(featureFlagOrganizations.flagKey, key),
        ),
      );
  }
}
