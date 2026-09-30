import type {
  OrganizationId,
  Placement,
  UserId,
  WidgetPreferenceRepository,
  WidgetPreferences,
} from "../../import.js";
import { and, eq, isNull, or, Uuid } from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { widgetPreferences } from "../schema/index.js";

// The rows that hide a card. Routed: the table is tenant-partitioned, so every statement
// names the tenant and prunes to its one partition.
export class PgWidgetPreferenceRepository
  extends BaseRepository
  implements WidgetPreferenceRepository
{
  protected override readonly placement: Placement = "routed";

  // The person's rows and the org's defaults in one statement, split after.
  public async findFor(organizationId: OrganizationId, userId: UserId): Promise<WidgetPreferences> {
    const rows = await this.db
      .select({ userId: widgetPreferences.userId, widget: widgetPreferences.widget })
      .from(widgetPreferences)
      .where(
        and(
          eq(widgetPreferences.organizationId, organizationId),
          or(eq(widgetPreferences.userId, userId), isNull(widgetPreferences.userId)),
        ),
      );

    return {
      hiddenByAdmin: rows.filter((row) => row.userId === null).map((row) => row.widget),
      hiddenByUser: rows.filter((row) => row.userId !== null).map((row) => row.widget),
    };
  }

  // No target: either partial unique index may be the one a repeat collides with, and
  // doing nothing is the answer for both.
  public async save(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void> {
    await this.db
      .insert(widgetPreferences)
      .values({ id: Uuid.v7(), organizationId, userId, widget })
      .onConflictDoNothing();
  }

  public async delete(
    organizationId: OrganizationId,
    userId: UserId | null,
    widget: string,
  ): Promise<void> {
    await this.db
      .delete(widgetPreferences)
      .where(
        and(
          eq(widgetPreferences.organizationId, organizationId),
          userId === null ? isNull(widgetPreferences.userId) : eq(widgetPreferences.userId, userId),
          eq(widgetPreferences.widget, widget),
        ),
      );
  }
}
