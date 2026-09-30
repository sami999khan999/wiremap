import { ConflictError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { PlatformHealthReader } from "./platform-health.reader.js";
import type { PlatformPolicyRepository } from "./platform-policy.repository.js";

export interface ToggleReplicaReadsInput {
  readonly enabled: boolean;
}

// Whether the worker's batch reads may be served by a standby — `25.2`. On is safe by
// construction: a read uses the replica only once it has caught up. See sharding.md.
export class ToggleReplicaReadsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policy: PlatformPolicyRepository,
    private readonly health: PlatformHealthReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ToggleReplicaReadsInput): Promise<void> {
    this.authorizer.assert(actor, "platform.replica.manage");

    // A switch over a standby nobody configured is a setting nothing reads, and the
    // day one is added it would already be on without anyone having decided that.
    if ((await this.health.replica()) === null) {
      throw new ConflictError("replica", "not_configured");
    }

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      const current = await this.policy.get();
      await this.policy.save({ ...current, replicaReadsEnabled: input.enabled });

      await this.activity.record(
        auditor,
        input.enabled ? "platform.replica.enabled" : "platform.replica.disabled",
        { replicaReadsEnabled: input.enabled },
      );
    });
  }
}
