import { type ActivityAction, ActivityActions } from "../import.js";
import type { AnalyticsProjector } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ProjectionPolicyRepository } from "./projection-policy.repository.js";
import { RetentionRules } from "./retention.rules.js";
import type { RetentionPolicyRepository } from "./retention-policy.repository.js";

// One row per catalog action, whether or not a policy row exists for it — the screen
// lists what the system can record, not what somebody has already edited.
export interface ProjectionEntry {
  readonly action: ActivityAction;
  readonly label: string;
  // The slice the action belongs to, off its own prefix. The screen groups by it, and
  // deriving it here keeps the fragments from having to repeat their own name.
  readonly module: string;
  readonly projected: boolean;
  readonly ttlMonths: number | null;
  // True when the values come from the code default rather than a row. "Projected
  // because nobody has decided" reads differently from "projected".
  readonly isDefault: boolean;
}

export interface ProjectionPolicies {
  readonly actions: readonly ProjectionEntry[];
  // The default window every action with no TTL of its own falls under.
  readonly defaultMonths: number;
  // What the store holds beside what the rows compose to. A screen showing only the
  // rows would say "saved" about a call that failed after the commit.
  readonly applied: string;
  readonly expected: string;
  // Absent on a deployment running no analytics store, which is the third state the
  // screen renders — not configured, rather than on or off.
  readonly configured: boolean;
}

export class ListProjectionPoliciesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policies: ProjectionPolicyRepository,
    private readonly retention: RetentionPolicyRepository,
    private readonly projector: AnalyticsProjector | null,
  ) {}

  public async execute(actor: Principal): Promise<ProjectionPolicies> {
    this.authorizer.assert(actor, "platform.analytics.read");

    const [rows, retentionRows] = await Promise.all([this.policies.all(), this.retention.all()]);
    const byAction = new Map(rows.map((row) => [row.action, row]));

    const defaultMonths = RetentionRules.clickhouseMonthsFrom(retentionRows);
    const expected = RetentionRules.clickhouseTtlFrom(retentionRows, rows);

    return {
      actions: ActivityActions.all().map((entry) => {
        const row = byAction.get(entry.action);
        return {
          action: entry.action,
          label: entry.label,
          module: entry.action.split(".")[0] ?? "",
          projected: row?.projected ?? true,
          ttlMonths: row?.ttlMonths ?? null,
          isDefault: row === undefined,
        };
      }),
      defaultMonths,
      expected,
      applied: this.projector ? await this.projector.retention() : "",
      configured: this.projector !== null,
    };
  }
}
