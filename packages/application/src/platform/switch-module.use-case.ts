import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { EntitlementRepository } from "./entitlement.repository.js";
import { EntitlementRules } from "./entitlement.rules.js";
import type { PlatformReader } from "./platform.reader.js";

export interface SwitchModuleInput {
  readonly module: string;
  readonly enabled: boolean;
  // Required to switch off, ignored to switch on: the reason is what the next person reads.
  readonly reason: string;
}

// The deployment-wide kill switch, for an incident. It overrides every plan and every
// adjustment, and `core` and `platform` cannot be switched off.
export class SwitchModuleUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly entitlements: EntitlementRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: SwitchModuleInput): Promise<void> {
    this.authorizer.assert(actor, "platform.module.manage");

    const module = EntitlementRules.assertSwitchable(input.module);
    const reason = input.enabled ? "" : EntitlementRules.assertReason(input.reason);

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      if (input.enabled) {
        await this.entitlements.deleteDisabledModule(module);
        await this.activity.record(auditor, "module.enabled", { module });
      } else {
        await this.entitlements.saveDisabledModule(module, reason, actor.userId);
        await this.activity.record(auditor, "module.disabled", { module, reason });
      }
    });

    // Every tenant: the switch is deployment-wide, so every cached set may hold the module.
    await this.capabilities.invalidateAll();
  }
}
