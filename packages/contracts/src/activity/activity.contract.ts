import { z } from "../import.js";
import { Identifiers, Keyset } from "../primitive/index.js";

export class ActivityContract {
  private constructor() {}

  // One audit row. `action` is a key of `ACTIVITY_ACTIONS`, kept a string on the wire so
  // a row written by a slice since removed still reads.
  public static readonly entity = z.object({
    id: z.uuid(),
    action: z.string().min(1),
    actorId: Identifiers.userId,
    // Null when the actor no longer exists: the trail outlives the account by design.
    actorName: z.string().nullable(),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.date(),
  });

  // Newest first, keyset-paged. Each filter narrows; none widens past the tenant.
  public static readonly listQuery = Keyset.query.extend({
    action: z.string().min(1).max(80).optional(),
    actorId: Identifiers.userId.optional(),
    from: z.date().optional(),
    to: z.date().optional(),
  });
}

export type ActivityDto = z.infer<typeof ActivityContract.entity>;
export type ActivityListQuery = z.infer<typeof ActivityContract.listQuery>;
