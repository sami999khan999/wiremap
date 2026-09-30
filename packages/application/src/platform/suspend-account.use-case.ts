import { type Clock, NotFoundError, type OrganizationId, type UserId } from "../import.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  SessionGateway,
  UnitOfWork,
} from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { AccountRepository } from "./account.repository.js";
import { AccountRules } from "./account.rules.js";
import type { PlatformReader } from "./platform.reader.js";

export interface SuspendAccountInput {
  readonly userId: UserId;
  readonly reason: string;
}

// The platform's lock on a compromised account, in every tenant at once. Loud: audited in
// the tier and in each tenant it belongs to, so their admins see who did it and why.
export class SuspendAccountUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly accounts: AccountRepository,
    private readonly platform: PlatformReader,
    private readonly invalidator: CapabilityInvalidator,
    private readonly sessions: SessionGateway,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: SuspendAccountInput): Promise<void> {
    this.authorizer.assert(actor, "platform.account.manage");
    AccountRules.assertNotSelf(actor.userId, input.userId);
    const reason = AccountRules.assertReason(input.reason);

    const account = await this.accounts.findById(input.userId);
    if (!account) throw new NotFoundError("account", input.userId);
    if (account.suspendedAt !== null) return;

    const tier = await this.platform.organizationId();
    AccountRules.assertNotLastHolder(
      await this.accounts.holdersOf(tier, AccountRules.RECOVERY_KEY),
      account.userId,
    );

    // The tier once, even when the account is a platform admin and a member of it.
    const organizations = new Set<OrganizationId>([
      tier,
      ...account.memberships.map((membership) => membership.organizationId),
    ]);
    const entry = { userId: account.userId, email: account.email, reason };

    // Each tenant's row is relayed to its own node by `PgActivityLogger`, inside this commit.
    await this.unitOfWork.run(async () => {
      await this.accounts.saveSuspension(account.userId, this.clock.now());
      for (const organizationId of organizations) {
        const auditor = new Principal(organizationId, actor.userId, actor.capabilities, actor.kind);
        await this.activity.record(auditor, "account.suspended", entry);
      }
    });

    for (const organizationId of organizations) {
      await this.invalidator.invalidate(organizationId, account.userId);
    }
    // After the commit, so a rolled-back suspend signs nobody out.
    await this.sessions.revokeAll(account.userId);
  }
}
