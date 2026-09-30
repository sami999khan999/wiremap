import { type ActivityAction, ActivityActions, ValidationError } from "../import.js";
import type { ActivityLogger, AnalyticsProjector, UnitOfWork } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { ProjectionPolicyRepository } from "./projection-policy.repository.js";
import { RetentionRules } from "./retention.rules.js";
import type { RetentionPolicyRepository } from "./retention-policy.repository.js";

export interface UpdateProjectionPolicyInput {
  readonly action: string;
  readonly projected: boolean;
  // Null is "the default clause covers it". A number is a clause of its own, which is
  // what lets one action be kept longer — or shorter — than the rest.
  readonly ttlMonths: number | null;
}

// Ten years. Not a business rule: a number past it composes a TTL ClickHouse accepts
// and no operator meant, and the screen has no way to show that it was a typo.
const MAX_MONTHS = 120;

export class UpdateProjectionPolicyUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policies: ProjectionPolicyRepository,
    private readonly retention: RetentionPolicyRepository,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
    private readonly projector: AnalyticsProjector | null,
    // Logged, never rethrown: the row is the truth and the daily job closes the gap, so
    // a store that was unreachable must not fail a save that committed.
    private readonly onDrift: (error: unknown) => void,
  ) {}

  public async execute(actor: Principal, input: UpdateProjectionPolicyInput): Promise<void> {
    this.authorizer.assert(actor, "platform.analytics.manage");

    const action = UpdateProjectionPolicyUseCase.assertKnownAction(input.action);
    UpdateProjectionPolicyUseCase.assertMonths(input.ttlMonths);

    // Rebased onto the tier, as every other platform write is: an audit row under the
    // admin's active tenant would say a customer changed a global setting.
    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.policies.save({ action, projected: input.projected, ttlMonths: input.ttlMonths });
      await this.activity.record(auditor, "platform.policy.changed", {
        store: "clickhouse",
        action,
        projected: input.projected,
        ttlMonths: input.ttlMonths,
      });
    });

    await this.apply();
  }

  // After the commit, never inside it: `MODIFY TTL` reaches a network and materialises
  // parts, and holding a transaction open across that is how a lock outlives a request.
  private async apply(): Promise<void> {
    if (!this.projector) return;

    try {
      const [rows, retentionRows] = await Promise.all([this.policies.all(), this.retention.all()]);
      const expression = RetentionRules.clickhouseTtlFrom(retentionRows, rows);

      // Compared before it is written, for the reason the daily job compares: `MODIFY
      // TTL` materialises every existing part, which on a years-deep table is a rewrite.
      if ((await this.projector.retention()) === expression) return;

      await this.projector.applyRetention(expression);
    } catch (error: unknown) {
      this.onDrift(error);
    }
  }

  private static assertKnownAction(action: string): ActivityAction {
    if (!ActivityActions.isKnown(action)) {
      throw new ValidationError([{ field: "action", rule: "unknown" }]);
    }
    return action;
  }

  private static assertMonths(ttlMonths: number | null): void {
    if (ttlMonths === null) return;
    if (!Number.isInteger(ttlMonths) || ttlMonths < 1 || ttlMonths > MAX_MONTHS) {
      throw new ValidationError([{ field: "ttlMonths", rule: "range" }]);
    }
  }
}
