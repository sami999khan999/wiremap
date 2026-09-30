import type { PartitionArchiveGateway, ProjectionGap } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { PartitionedTable } from "../primitive/index.js";

// Months the derived store never fully received. The reason a gap exists is on the
// `analytics.projection.gap` log line and not stored, so this says only that one does.
export class ListProjectionGapsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly archive: PartitionArchiveGateway,
  ) {}

  public async execute(actor: Principal): Promise<readonly ProjectionGap[]> {
    this.authorizer.assert(actor, "platform.analytics.read");

    return this.archive.gaps(PartitionedTable.ACTIVITY_LOG);
  }
}
