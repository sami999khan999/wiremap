import {
  type ActivityAction,
  type ProjectionPolicyRecord,
  ProjectionPolicyRepository,
} from "../import.js";

// Rows in a Map, keyed the way the table is. Empty by default, which is the state that
// matters: an absent row is "projected, with the default TTL".
export class InMemoryProjectionPolicyRepository extends ProjectionPolicyRepository {
  private readonly rows = new Map<ActivityAction, ProjectionPolicyRecord>();

  public constructor(rows: readonly ProjectionPolicyRecord[] = []) {
    super();
    for (const row of rows) this.rows.set(row.action, row);
  }

  public override all(): Promise<readonly ProjectionPolicyRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public override save(record: ProjectionPolicyRecord): Promise<void> {
    this.rows.set(record.action, record);
    return Promise.resolve();
  }
}
