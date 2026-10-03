import {
  type ActivityPage,
  type ActivityQuery,
  type ActivityReader,
  and,
  desc,
  eq,
  type OrganizationId,
  type Placement,
  sql,
} from "../../import.js";
import { BaseRepository, KeysetCursor } from "../primitive/index.js";
import { activityLog } from "../schema/index.js";

// The audit trail, newest first. `local` like its logger: it reads `activity_log` alone,
// and names are the use-case's to resolve.
export class PgActivityReader extends BaseRepository implements ActivityReader {
  protected override readonly placement: Placement = "local";

  public async list(organizationId: OrganizationId, query: ActivityQuery): Promise<ActivityPage> {
    const after = query.cursor ? KeysetCursor.decode(query.cursor) : null;

    // `limit + 1` and a row constructor on `activity_log_org_time_idx`, for the reasons
    // `PgNotificationRepository.list` gives.
    const rows = await this.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.organizationId, organizationId),
          query.action ? eq(activityLog.action, query.action) : undefined,
          query.actorId ? eq(activityLog.actorId, query.actorId) : undefined,
          query.from ? sql`${activityLog.occurredAt} >= ${query.from}` : undefined,
          query.to ? sql`${activityLog.occurredAt} < ${query.to}` : undefined,
          query.projectId
            ? sql`${activityLog.payload}->>'projectId' = ${query.projectId}`
            : undefined,
          after
            ? sql`(${activityLog.occurredAt}, ${activityLog.id}) < (${after.at}, ${after.id}::uuid)`
            : undefined,
          after ? sql`${activityLog.occurredAt} <= ${after.at}` : undefined,
        ),
      )
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        actorId: row.actorId,
        actorName: null,
        payload: row.payload,
        occurredAt: row.occurredAt,
      })),
      nextCursor:
        rows.length > query.limit && last ? KeysetCursor.encode(last.occurredAt, last.id) : null,
    };
  }
}
