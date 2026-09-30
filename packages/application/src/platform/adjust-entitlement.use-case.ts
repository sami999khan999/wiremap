import { type Clock, NotFoundError, ValidationError } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import { EntitlementRules } from "./entitlement.rules.js";
import type { PlatformReader } from "./platform.reader.js";
import type { ShardMapReader } from "./shard-map.reader.js";

export interface AdjustEntitlementInput {
  // An organization id or a slug, whichever the operator is holding.
  readonly organization: string;
  readonly permission: string;
  readonly effect: "add" | "remove";
  readonly reason: string;
  // Null is permanent. A trial is an `add` with one.
  readonly expiresAt: Date | null;
}

// One org's departure from its plan. It closes over `requires` both ways, so the org is
// never left entitled to a key that cannot work — `RV.13`.
export class AdjustEntitlementUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly tenants: ShardMapReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(
    actor: Principal,
    input: AdjustEntitlementInput,
  ): Promise<readonly string[]> {
    this.authorizer.assert(actor, "platform.entitlement.manage");

    const key = EntitlementRules.assertMaskable(input.permission);
    const reason = EntitlementRules.assertReason(input.reason);
    if (input.expiresAt && input.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new ValidationError([{ field: "expiresAt", rule: "past" }]);
    }

    const term = input.organization.trim();
    const tenant = await this.tenants.findByTerm(term);
    if (!tenant) throw new NotFoundError("organization", term);

    // The same expiry and reason on every key the closure reaches: a trial of `invite`
    // that outlived the trial of the role list it needs would be broken for its tail.
    const keys = EntitlementRules.closeAdjustment(key, input.effect);

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    const inTenant = new Principal(
      tenant.organizationId,
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.entitlements.saveAdjustments(
        tenant.organizationId,
        keys.map((permission) => ({
          permission,
          effect: input.effect,
          reason,
          expiresAt: input.expiresAt,
        })),
        actor.userId,
      );
      const entry = {
        organizationId: tenant.organizationId,
        slug: tenant.slug,
        effect: input.effect,
        permissions: keys.join(","),
        reason,
        expiresAt: input.expiresAt?.toISOString() ?? "",
      };
      await this.activity.record(auditor, "entitlement.adjusted", entry);
      await this.activity.record(inTenant, "entitlement.adjusted", entry);
    });

    await this.capabilities.invalidateOrganization(tenant.organizationId);
    return keys;
  }
}
