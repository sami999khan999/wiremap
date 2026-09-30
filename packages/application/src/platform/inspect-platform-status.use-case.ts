import type { Authorizer, Principal } from "../primitive/index.js";
import type { PlatformOrganization, PlatformReader } from "./platform.reader.js";
import type {
  PlatformHealth,
  PlatformHealthReader,
  ReplicaHealthReport,
} from "./platform-health.reader.js";
import type { PlatformPolicyRepository } from "./platform-policy.repository.js";

export interface ReplicaStatus extends ReplicaHealthReport {
  // The switch beside the reading, so the page that shows the lag is the one that
  // decides whether anything reads through it — `25.2`.
  readonly readsEnabled: boolean;
}

export interface PlatformStatus {
  readonly organization: PlatformOrganization;
  readonly health: PlatformHealth;
  readonly replica: ReplicaStatus | null;
}

// The proof page. It reads nothing a tenant screen could not, and that is the point: it
// is here to show the tier resolves end to end before any policy depends on it.
export class InspectPlatformStatusUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly platform: PlatformReader,
    private readonly health: PlatformHealthReader,
    private readonly policy: PlatformPolicyRepository,
  ) {}

  public async execute(actor: Principal): Promise<PlatformStatus> {
    // The key is platform-scoped, so this denies a tenant owner holding every tenant key —
    // which is the whole of decision D31 arriving at a call site.
    this.authorizer.assert(actor, "platform.status.read");

    const [organization, health, replica, policy] = await Promise.all([
      this.platform.organization(),
      this.health.report(),
      this.health.replica(),
      this.policy.get(),
    ]);

    return {
      organization,
      health,
      replica: replica ? { ...replica, readsEnabled: policy.replicaReadsEnabled } : null,
    };
  }
}
