import { NotFoundError, type OrganizationId, type UserId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { AccountRepository } from "./account.repository.js";
import { AccountRules } from "./account.rules.js";
import type { PlatformReader } from "./platform.reader.js";

export interface ReinstateAccountInput {
  readonly userId: UserId;
  readonly reason: string;
}

// Lifts the platform's lock and nothing else. A tenant that deactivated the membership, or
// a platform deny, stays as it was: each is its own decision.
export class ReinstateAccountUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly accounts: AccountRepository,
    private readonly platform: PlatformReader,
    private readonly invalidator: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ReinstateAccountInput): Promise<void> {
    this.authorizer.assert(actor, "platform.account.manage");
    const reason = AccountRules.assertReason(input.reason);

    const account = await this.accounts.findById(input.userId);
    if (!account) throw new NotFoundError("account", input.userId);
    if (account.suspendedAt === null) return;

    const tier = await this.platform.organizationId();
    const organizations = new Set<OrganizationId>([
      tier,
      ...account.memberships.map((membership) => membership.organizationId),
    ]);
    const entry = { userId: account.userId, email: account.email, reason };

    await this.unitOfWork.run(async () => {
      await this.accounts.saveSuspension(account.userId, null);
      for (const organizationId of organizations) {
        const auditor = new Principal(organizationId, actor.userId, actor.capabilities, actor.kind);
        await this.activity.record(auditor, "account.reinstated", entry);
      }
    });

    for (const organizationId of organizations) {
      await this.invalidator.invalidate(organizationId, account.userId);
    }
  }
}
