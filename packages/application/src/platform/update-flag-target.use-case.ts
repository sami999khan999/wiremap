import type { FlagCache, FlagRepository } from "../flag/index.js";
import { FlagRegistry, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { ShardMapReader } from "./shard-map.reader.js";

export interface UpdateFlagTargetInput {
  readonly key: string;
  // An organization id or a slug, whichever the operator is holding.
  readonly organization: string;
  readonly enabled: boolean;
}

// Turns a declared flag on or off for one org while the deployment-wide switch stays as
// it is. Adding a target to an off flag is the whole of a staged rollout.
export class UpdateFlagTargetUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly flags: FlagRepository,
    private readonly cache: FlagCache,
    // The directory's own lookup, so a flag admin needs no shard permission to name a tenant.
    private readonly tenants: ShardMapReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateFlagTargetInput): Promise<void> {
    this.authorizer.assert(actor, "platform.flag.manage");

    if (!FlagRegistry.instance.isKnown(input.key)) throw new NotFoundError("flag", input.key);

    const term = input.organization.trim();
    const tenant = await this.tenants.findByTerm(term);
    if (!tenant) throw new NotFoundError("organization", term);

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      if (input.enabled) {
        await this.flags.saveTarget(input.key, tenant.organizationId, actor.userId);
      } else {
        await this.flags.deleteTarget(input.key, tenant.organizationId);
      }
      await this.activity.record(
        auditor,
        input.enabled ? "flag.organization.added" : "flag.organization.removed",
        { key: input.key, organizationId: tenant.organizationId, slug: tenant.slug },
      );
    });

    await this.cache.invalidate();
  }
}
