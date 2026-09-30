import type { Authorizer, Principal } from "../primitive/index.js";
import type { PlatformHealthReader } from "./platform-health.reader.js";
import type {
  PlatformPolicyRecord,
  PlatformPolicyRepository,
} from "./platform-policy.repository.js";

export interface PlatformPolicyView extends PlatformPolicyRecord {
  // Whether the deployment runs an analytics store at all. The screen renders three
  // states, and this is the one the row cannot express.
  readonly analyticsConfigured: boolean;
}

export class GetPlatformPolicyUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policy: PlatformPolicyRepository,
    private readonly health: PlatformHealthReader,
  ) {}

  public async execute(actor: Principal): Promise<PlatformPolicyView> {
    this.authorizer.assert(actor, "platform.analytics.read");

    const [record, report] = await Promise.all([this.policy.get(), this.health.report()]);

    return { ...record, analyticsConfigured: report.analytics !== null };
  }
}
