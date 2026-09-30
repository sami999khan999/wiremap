import { ConflictError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { PlatformHealthReader } from "./platform-health.reader.js";
import type { PlatformPolicyRepository } from "./platform-policy.repository.js";

export interface ToggleProjectionInput {
  readonly enabled: boolean;
}

// A pause, not a power switch — decision 12. Off stops the consumer projecting and
// nothing else; resume needs no state, because the checkpoint is read from the store.
export class ToggleProjectionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policy: PlatformPolicyRepository,
    private readonly health: PlatformHealthReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ToggleProjectionInput): Promise<void> {
    this.authorizer.assert(actor, "platform.analytics.manage");

    // `null` is "this deployment runs no analytics store", which is neither on nor off.
    // Saving a switch over a store that does not exist is a setting nothing reads.
    if ((await this.health.report()).analytics === null) {
      throw new ConflictError("analytics", "not_configured");
    }

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      const current = await this.policy.get();
      await this.policy.save({ ...current, projectionEnabled: input.enabled });

      await this.activity.record(
        auditor,
        input.enabled ? "platform.projection.resumed" : "platform.projection.paused",
        { projectionEnabled: input.enabled },
      );
    });
  }
}
