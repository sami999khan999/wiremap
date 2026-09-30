import type { Clock } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ActivityCount, AnalyticsReader } from "./analytics.reader.js";

export interface GetActivityTrendInput {
  readonly days: 30 | 90;
}

export interface ActivityTrend {
  // False on a deployment that runs no analytics store: the screen says so rather than
  // showing an empty chart, which would read as a tenant that did nothing.
  readonly configured: boolean;
  readonly from: string;
  readonly to: string;
  readonly points: readonly ActivityCount[];
}

const DAY_MS = 24 * 60 * 60 * 1_000;

// The first dashboard: what happened in this tenant, per day and per action.
export class GetActivityTrendUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly reader: AnalyticsReader | null,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: GetActivityTrendInput): Promise<ActivityTrend> {
    this.authorizer.assert(actor, "analytics.activity.read");

    // Today included: the window ends at tomorrow's midnight, UTC, and starts `days`
    // midnights before that. A window ending at today's would hide today entirely.
    const now = this.clock.now();
    const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const from = GetActivityTrendUseCase.iso(tomorrow - input.days * DAY_MS);
    const to = GetActivityTrendUseCase.iso(tomorrow);

    if (!this.reader) return { configured: false, from, to, points: [] };

    const points = await this.reader.activityByDay(actor.organizationId, from, to);
    return { configured: true, from, to, points };
  }

  private static iso(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
