import { type FlagRecord, FlagRepository, type OrganizationId, type UserId } from "../import.js";

// Rows in a map, and a target names its org by id alone: the fake has no tenants to take
// a slug from, so it echoes the id, which a spec can still assert on.
export class InMemoryFlagRepository extends FlagRepository {
  private readonly rows = new Map<string, FlagRecord>();

  public override findAll(): Promise<readonly FlagRecord[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  public override save(key: string, isEnabled: boolean, _actor: UserId): Promise<void> {
    this.rows.set(key, {
      key,
      isEnabled,
      targets: this.rows.get(key)?.targets ?? [],
      updatedAt: new Date(0),
    });
    return Promise.resolve();
  }

  public override saveTarget(
    key: string,
    organizationId: OrganizationId,
    _actor: UserId,
  ): Promise<void> {
    const current = this.rows.get(key);
    const targets = current?.targets ?? [];
    if (!targets.some((target) => target.organizationId === organizationId)) {
      this.rows.set(key, {
        key,
        isEnabled: current?.isEnabled ?? false,
        targets: [...targets, { organizationId, slug: organizationId }],
        updatedAt: new Date(0),
      });
    }
    return Promise.resolve();
  }

  public override deleteTarget(key: string, organizationId: OrganizationId): Promise<void> {
    const current = this.rows.get(key);
    if (current) {
      this.rows.set(key, {
        ...current,
        targets: current.targets.filter((target) => target.organizationId !== organizationId),
      });
    }
    return Promise.resolve();
  }
}
