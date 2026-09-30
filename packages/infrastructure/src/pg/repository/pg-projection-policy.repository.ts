import type {
  Placement,
  ProjectionPolicyRecord,
  ProjectionPolicyRepository,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { projectionPolicy } from "../schema/index.js";

export class PgProjectionPolicyRepository
  extends BaseRepository
  implements ProjectionPolicyRepository
{
  // Deployment-wide policy.
  protected override readonly placement: Placement = "catalog";

  public async all(): Promise<readonly ProjectionPolicyRecord[]> {
    return this.db
      .select({
        action: projectionPolicy.action,
        projected: projectionPolicy.projected,
        ttlMonths: projectionPolicy.ttlMonths,
      })
      .from(projectionPolicy)
      .orderBy(projectionPolicy.action) as Promise<readonly ProjectionPolicyRecord[]>;
  }

  // Upsert, because the screen edits a row that may not exist: an absent row *is* the
  // default, and the first save should not have to know that.
  public async save(record: ProjectionPolicyRecord): Promise<void> {
    await this.db
      .insert(projectionPolicy)
      .values({ ...record, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: projectionPolicy.action,
        set: {
          projected: record.projected,
          ttlMonths: record.ttlMonths,
          updatedAt: new Date(),
        },
      });
  }
}
