import { type OrganizationId, type UserId, UserReader } from "../import.js";

// Empty by default, so a spec that is not about names gets `null` on every member and
// the component's fallback copy is what renders. Naming someone is opt-in.
export class InMemoryUserReader extends UserReader {
  private readonly names: ReadonlyMap<UserId, string>;

  public constructor(names: Iterable<readonly [UserId, string]> = []) {
    super();
    this.names = new Map(names);
  }

  public override namesOf(
    _organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>> {
    const found = new Map<UserId, string>();

    for (const userId of userIds) {
      const name = this.names.get(userId);
      if (name !== undefined) found.set(userId, name);
    }

    return Promise.resolve(found);
  }
}
