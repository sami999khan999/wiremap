import { type PlatformPolicyRecord, PlatformPolicyRepository } from "../import.js";

// The defaults, held. An absent row is those defaults in the real one too, so a fake
// that started empty and returned null would be a state nothing can reach.
export class InMemoryPlatformPolicyRepository extends PlatformPolicyRepository {
  private record: PlatformPolicyRecord;

  public constructor(record: Partial<PlatformPolicyRecord> = {}) {
    super();
    this.record = {
      projectionEnabled: true,
      replicaReadsEnabled: false,
      moveGraceDays: null,
      ...record,
    };
  }

  public override get(): Promise<PlatformPolicyRecord> {
    return Promise.resolve(this.record);
  }

  public override save(record: PlatformPolicyRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
}
