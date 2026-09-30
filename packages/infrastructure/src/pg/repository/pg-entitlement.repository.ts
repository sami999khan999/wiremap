import type {
  AdjustmentInput,
  AdjustmentRecord,
  EntitlementRepository,
  ModuleSwitchRecord,
  OrganizationId,
  Placement,
  PlanInput,
  PlanRecord,
  UserId,
} from "../../import.js";
import { and, asc, count, eq, inArray, lte, sql, Uuid } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import {
  disabledModules,
  entitlementAdjustments,
  organizations,
  planPermissions,
  plans,
  platformPolicy,
} from "../schema/index.js";

// The singleton row `platform_policy` keeps its default plan on. See pg-platform-policy.
const POLICY_ROW = 1;

// What the mask is built from, as a platform admin edits it. The hot read — resolution —
// is `PgCapabilityRepository.entitlementFor`, one statement; everything here is a screen.
export class PgEntitlementRepository extends BaseRepository implements EntitlementRepository {
  protected override readonly placement: Placement = "catalog";

  // Three statements for the whole list, not one per plan: the rows, their keys, and the
  // org count that refuses a delete.
  public async findPlans(): Promise<readonly PlanRecord[]> {
    return this.plansWhere(undefined);
  }

  public async findPlan(key: string): Promise<PlanRecord | null> {
    return (await this.plansWhere(key))[0] ?? null;
  }

  // The row and its keys reconciled in one call, inside the caller's unit of work.
  public async savePlan(plan: PlanInput): Promise<void> {
    await this.db
      .insert(plans)
      .values({ key: plan.key, name: plan.name, description: plan.description })
      .onConflictDoUpdate({
        target: plans.key,
        set: { name: plan.name, description: plan.description, updatedAt: new Date() },
      });
    await this.db.delete(planPermissions).where(eq(planPermissions.planKey, plan.key));
    if (plan.permissions.length > 0) {
      await this.db
        .insert(planPermissions)
        .values(plan.permissions.map((permission) => ({ planKey: plan.key, permission })));
    }
  }

  public async deletePlan(key: string): Promise<void> {
    await this.db.delete(plans).where(eq(plans.key, key));
  }

  public async findDefaultPlan(): Promise<string> {
    const rows = await this.db
      .select({ key: platformPolicy.defaultPlanKey })
      .from(platformPolicy)
      .limit(1);
    return rows[0]?.key ?? "unlimited";
  }

  // Upsert on the fixed id, touching this column alone: the policy's other switches are
  // `PgPlatformPolicyRepository`'s, and its save never writes this one.
  public async saveDefaultPlan(key: string): Promise<void> {
    await this.db
      .insert(platformPolicy)
      .values({ id: POLICY_ROW, defaultPlanKey: key, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformPolicy.id,
        set: { defaultPlanKey: key, updatedAt: new Date() },
      });
  }

  public async findPlanOf(organizationId: OrganizationId): Promise<string | null> {
    const rows = await this.db
      .select({ key: organizations.planKey })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return rows[0]?.key ?? null;
  }

  public async savePlanOf(organizationId: OrganizationId, planKey: string): Promise<void> {
    await this.db
      .update(organizations)
      .set({ planKey })
      .where(eq(organizations.id, organizationId));
  }

  public async findAdjustments(
    organizationId: OrganizationId,
  ): Promise<readonly AdjustmentRecord[]> {
    return this.db
      .select(PgEntitlementRepository.ADJUSTMENT)
      .from(entitlementAdjustments)
      .where(eq(entitlementAdjustments.organizationId, organizationId))
      .orderBy(asc(entitlementAdjustments.permission));
  }

  // One statement for the whole closure. A second adjustment of one key replaces the
  // first, which is what makes "remove what I added" a single call.
  public async saveAdjustments(
    organizationId: OrganizationId,
    rows: readonly AdjustmentInput[],
    actor: UserId,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(entitlementAdjustments)
      .values(
        rows.map((row) => ({
          id: Uuid.v7(),
          organizationId,
          permission: row.permission,
          effect: row.effect,
          reason: row.reason,
          expiresAt: row.expiresAt,
          createdBy: actor,
        })),
      )
      .onConflictDoUpdate({
        target: [entitlementAdjustments.organizationId, entitlementAdjustments.permission],
        set: {
          effect: sql`excluded.effect`,
          reason: sql`excluded.reason`,
          expiresAt: sql`excluded.expires_at`,
          createdBy: sql`excluded.created_by`,
          createdAt: sql`now()`,
        },
      });
  }

  public async deleteAdjustment(
    organizationId: OrganizationId,
    permission: string,
  ): Promise<boolean> {
    const removed = await this.db
      .delete(entitlementAdjustments)
      .where(
        and(
          eq(entitlementAdjustments.organizationId, organizationId),
          eq(entitlementAdjustments.permission, permission),
        ),
      )
      .returning({ id: entitlementAdjustments.id });
    return removed.length > 0;
  }

  // On the partial expiry index. Every org's, because the sweep is one pass for all.
  public async findExpired(now: Date): Promise<readonly AdjustmentRecord[]> {
    return this.db
      .select(PgEntitlementRepository.ADJUSTMENT)
      .from(entitlementAdjustments)
      .where(lte(entitlementAdjustments.expiresAt, now));
  }

  public async findDisabledModules(): Promise<readonly ModuleSwitchRecord[]> {
    return this.db
      .select({
        module: disabledModules.module,
        reason: disabledModules.reason,
        disabledAt: disabledModules.disabledAt,
      })
      .from(disabledModules)
      .orderBy(asc(disabledModules.module));
  }

  public async saveDisabledModule(module: string, reason: string, actor: UserId): Promise<void> {
    await this.db
      .insert(disabledModules)
      .values({ module, reason, disabledBy: actor })
      .onConflictDoUpdate({
        target: disabledModules.module,
        set: { reason, disabledBy: actor, disabledAt: new Date() },
      });
  }

  public async deleteDisabledModule(module: string): Promise<void> {
    await this.db.delete(disabledModules).where(eq(disabledModules.module, module));
  }

  private static readonly ADJUSTMENT = {
    organizationId: entitlementAdjustments.organizationId,
    permission: entitlementAdjustments.permission,
    effect: entitlementAdjustments.effect,
    reason: entitlementAdjustments.reason,
    expiresAt: entitlementAdjustments.expiresAt,
    createdAt: entitlementAdjustments.createdAt,
  };

  private async plansWhere(key: string | undefined): Promise<readonly PlanRecord[]> {
    const rows = await this.db
      .select()
      .from(plans)
      .where(key === undefined ? undefined : eq(plans.key, key))
      .orderBy(asc(plans.key));
    if (rows.length === 0) return [];

    const keys = rows.map((row) => row.key);
    const [permissions, usage] = await Promise.all([
      this.db
        .select({ planKey: planPermissions.planKey, permission: planPermissions.permission })
        .from(planPermissions)
        .where(inArray(planPermissions.planKey, keys))
        .orderBy(asc(planPermissions.permission)),
      this.db
        .select({ planKey: organizations.planKey, organizations: count() })
        .from(organizations)
        .where(inArray(organizations.planKey, keys))
        .groupBy(organizations.planKey),
    ]);

    const counts = new Map(usage.map((row) => [row.planKey, row.organizations]));
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      description: row.description,
      isUnlimited: row.isUnlimited,
      isSystem: row.isSystem,
      permissions: permissions
        .filter((entry) => entry.planKey === row.key)
        .map((entry) => entry.permission),
      organizations: counts.get(row.key) ?? 0,
    }));
  }
}
