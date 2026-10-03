import type { UserReader } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { ActivityPage, ActivityQuery, ActivityReader } from "./activity.reader.js";

export class ListActivityUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly reader: ActivityReader,
    private readonly users: UserReader,
  ) {}

  // `projectId` is the project feed's filter and is not offered here: the audit log is
  // the whole tenant, and its filters are the four the page shows.
  public async execute(
    actor: Principal,
    query: Omit<ActivityQuery, "projectId">,
  ): Promise<ActivityPage> {
    this.authorizer.assert(actor, "audit.log.read");
    const page = await this.reader.list(actor.organizationId, query);

    // One read for every actor on the page. The trail is `local` and names are `catalog`,
    // so a join is the one thing this read may not do.
    const names = await this.users.namesOf(actor.organizationId, [
      ...new Set(page.items.map((item) => item.actorId)),
    ]);
    return {
      ...page,
      items: page.items.map((item) => ({ ...item, actorName: names.get(item.actorId) ?? null })),
    };
  }
}
