import {
  NotFoundError,
  type OrganizationId,
  PermissionRegistry,
  type UserId,
  ValidationError,
} from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { PermissionOverrideRepository } from "../rbac/index.js";
import type { AccountRepository } from "./account.repository.js";
import { AccountRules } from "./account.rules.js";
import type { PlatformReader } from "./platform.reader.js";

export interface DenyAccountPermissionInput {
  readonly userId: UserId;
  // Where the deny lives: a tenant the person belongs to, or the tier for a platform key.
  readonly organizationId: OrganizationId;
  readonly permission: string;
  readonly reason: string;
}

// One key from one person in one tenant, which that tenant's admin sees and cannot clear.
// Permanent: a grant lapses because nobody reviews it, and a deny is safe to leave.
export class DenyAccountPermissionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly accounts: AccountRepository,
    private readonly overrides: PermissionOverrideRepository,
    private readonly platform: PlatformReader,
    private readonly invalidator: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(
    actor: Principal,
    input: DenyAccountPermissionInput,
  ): Promise<readonly string[]> {
    this.authorizer.assert(actor, "platform.account.manage");
    AccountRules.assertNotSelf(actor.userId, input.userId);
    const key = AccountRules.assertDeniable(input.permission);
    const reason = AccountRules.assertReason(input.reason);

    const account = await this.accounts.findById(input.userId);
    if (!account) throw new NotFoundError("account", input.userId);
    const member = account.memberships.some((m) => m.organizationId === input.organizationId);
    if (!member) throw new NotFoundError("member", input.userId);

    // A platform key is only ever held in the tier, so a deny of one anywhere else is inert.
    const tier = await this.platform.organizationId();
    if (AccountRules.isPlatformKey(key) !== (input.organizationId === tier)) {
      throw new ValidationError([{ field: "organizationId", rule: "invalid" }]);
    }

    // Everything that requires the key goes too (`RV.13`), the recovery key included.
    const keys = PermissionRegistry.instance.dependentClosure([key]);
    if (AccountRules.reachesRecovery(keys)) {
      AccountRules.assertNotLastHolder(
        await this.accounts.holdersOf(tier, AccountRules.RECOVERY_KEY),
        account.userId,
      );
    }

    const organizations = new Set<OrganizationId>([input.organizationId, tier]);
    await this.unitOfWork.run(async () => {
      await this.overrides.save(
        input.organizationId,
        account.userId,
        keys.map((permission) => ({
          permission,
          effect: "deny",
          reason,
          expiresAt: null,
          authority: "platform",
        })),
        actor.userId,
      );
      for (const organizationId of organizations) {
        const auditor = new Principal(organizationId, actor.userId, actor.capabilities, actor.kind);
        await this.activity.record(auditor, "override.denied", {
          userId: account.userId,
          organizationId: input.organizationId,
          permissions: keys.join(","),
          reason,
          authority: "platform",
        });
      }
    });

    await this.invalidator.invalidate(input.organizationId, account.userId);
    return keys;
  }
}
