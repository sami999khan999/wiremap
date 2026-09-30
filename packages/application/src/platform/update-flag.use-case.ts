import type { FlagCache, FlagRepository } from "../flag/index.js";
import { ConflictError, FlagRegistry, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";

export interface UpdateFlagInput {
  readonly key: string;
  readonly enabled: boolean;
}

// The deployment-wide switch. An orphaned row may be switched off, never on: turning off
// is how a retired flag's row is cleared, and turning on would switch nothing any code reads.
export class UpdateFlagUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly flags: FlagRepository,
    private readonly cache: FlagCache,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: UpdateFlagInput): Promise<void> {
    this.authorizer.assert(actor, "platform.flag.manage");

    if (!FlagRegistry.instance.isKnown(input.key)) {
      const rows = await this.flags.findAll();
      if (!rows.some((row) => row.key === input.key)) throw new NotFoundError("flag", input.key);
      if (input.enabled) throw new ConflictError("flag", "undeclared");
    }

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );

    await this.unitOfWork.run(async () => {
      await this.flags.save(input.key, input.enabled, actor.userId);
      await this.activity.record(auditor, input.enabled ? "flag.enabled" : "flag.disabled", {
        key: input.key,
      });
    });

    await this.cache.invalidate();
  }
}
