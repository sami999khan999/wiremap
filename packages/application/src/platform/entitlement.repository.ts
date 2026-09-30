import type { OrganizationId, UserId } from "../import.js";

export interface PlanRecord {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  // Every tenant key, resolved at read time. Its `permissions` are empty and ignored.
  readonly isUnlimited: boolean;
  // Shipped by a migration. Never edited or deleted from a screen.
  readonly isSystem: boolean;
  // Raw and unfiltered, like a role's: the registry decides what a stale row means.
  readonly permissions: readonly string[];
  // How many orgs are on it, which is what refuses a delete.
  readonly organizations: number;
}

export interface PlanInput {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
}

export interface AdjustmentRecord {
  readonly organizationId: OrganizationId;
  readonly permission: string;
  readonly effect: "add" | "remove";
  readonly reason: string;
  // Null is permanent. A trial is an `add` with one.
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

export interface AdjustmentInput {
  readonly permission: string;
  readonly effect: "add" | "remove";
  readonly reason: string;
  readonly expiresAt: Date | null;
}

export interface ModuleSwitchRecord {
  readonly module: string;
  readonly reason: string;
  readonly disabledAt: Date;
}

// Plans, per-org adjustments and the kill switch: every row the mask is built from, as a
// platform admin edits them. Catalog placement throughout — resolution reads them first.
export abstract class EntitlementRepository {
  public abstract findPlans(): Promise<readonly PlanRecord[]>;

  public abstract findPlan(key: string): Promise<PlanRecord | null>;

  // The row and its keys in one write, reconciled to `permissions`.
  public abstract savePlan(plan: PlanInput): Promise<void>;

  public abstract deletePlan(key: string): Promise<void>;

  // `platform_policy.default_plan_key`: what a new signup lands on.
  public abstract findDefaultPlan(): Promise<string>;

  public abstract saveDefaultPlan(key: string): Promise<void>;

  public abstract findPlanOf(organizationId: OrganizationId): Promise<string | null>;

  public abstract savePlanOf(organizationId: OrganizationId, planKey: string): Promise<void>;

  // Live and expired alike: the screen shows an expired trial until the sweep removes it.
  public abstract findAdjustments(
    organizationId: OrganizationId,
  ): Promise<readonly AdjustmentRecord[]>;

  // Upserted on `(organization_id, permission)`: a second adjustment of one key replaces it.
  public abstract saveAdjustments(
    organizationId: OrganizationId,
    rows: readonly AdjustmentInput[],
    actor: UserId,
  ): Promise<void>;

  // `false` when there was nothing to clear, so a retry is not an error.
  public abstract deleteAdjustment(
    organizationId: OrganizationId,
    permission: string,
  ): Promise<boolean>;

  // Every org's, for the worker's sweep. At or before `now`.
  public abstract findExpired(now: Date): Promise<readonly AdjustmentRecord[]>;

  public abstract findDisabledModules(): Promise<readonly ModuleSwitchRecord[]>;

  public abstract saveDisabledModule(module: string, reason: string, actor: UserId): Promise<void>;

  public abstract deleteDisabledModule(module: string): Promise<void>;
}
