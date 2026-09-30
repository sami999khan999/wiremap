import type { Placement, PlatformPolicyRecord, PlatformPolicyRepository } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { platformPolicy } from "../schema/index.js";

// The singleton's id. `check (id = 1)` in the schema is what makes reading without an
// `order by` correct rather than lucky.
const ROW = 1;

// `moveGraceDays: null` is the shipped answer, not a placeholder: unset means the
// deployment's own default, which the operator overrides from the platform screen.
const DEFAULTS: PlatformPolicyRecord = {
  projectionEnabled: true,
  replicaReadsEnabled: false,
  moveGraceDays: null,
};

export class PgPlatformPolicyRepository extends BaseRepository implements PlatformPolicyRepository {
  // Deployment-wide policy.
  protected override readonly placement: Placement = "catalog";

  public async get(): Promise<PlatformPolicyRecord> {
    const rows = await this.db
      .select({
        projectionEnabled: platformPolicy.projectionEnabled,
        replicaReadsEnabled: platformPolicy.replicaReadsEnabled,
        moveGraceDays: platformPolicy.moveGraceDays,
      })
      .from(platformPolicy)
      .limit(1);

    return rows[0] ?? DEFAULTS;
  }

  // Upsert on the fixed id: the row may not exist, because the migration deliberately
  // does not insert it, and the first save is what creates it.
  public async save(record: PlatformPolicyRecord): Promise<void> {
    await this.db
      .insert(platformPolicy)
      .values({ id: ROW, ...record, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformPolicy.id,
        set: { ...record, updatedAt: new Date() },
      });
  }
}
