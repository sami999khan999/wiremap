import {
  type OrganizationId,
  type UserId,
  WidgetPreferenceRepository,
  type WidgetPreferences,
} from "../import.js";

// One set of row keys, `<org>|<user or empty>|<widget>`: the same identity the two partial
// unique indexes give the real table, so a repeated hide is one row here too.
export class InMemoryWidgetPreferenceRepository extends WidgetPreferenceRepository {
  private readonly rows = new Set<string>();

  public override findFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<WidgetPreferences> {
    const hiddenByAdmin: string[] = [];
    const hiddenByUser: string[] = [];
    for (const row of this.rows) {
      const [org, user, widget] = row.split("|");
      if (org !== organizationId || widget === undefined) continue;
      if (user === "") hiddenByAdmin.push(widget);
      else if (user === userId) hiddenByUser.push(widget);
    }
    return Promise.resolve({ hiddenByAdmin, hiddenByUser });
  }

  public override save(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void> {
    this.rows.add(`${organizationId}|${userId ?? ""}|${widget}`);
    return Promise.resolve();
  }

  public override delete(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void> {
    this.rows.delete(`${organizationId}|${userId ?? ""}|${widget}`);
    return Promise.resolve();
  }
}
