import {
  and,
  eq,
  inArray,
  type NotificationCategory,
  type NotificationPreferenceRepository,
  type OrganizationId,
  type Placement,
  type PreferenceRecord,
  sql,
  type UserId,
  Uuid,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { notificationPreferences } from "../schema/index.js";

export class PgNotificationPreferenceRepository
  extends BaseRepository
  implements NotificationPreferenceRepository
{
  // `notification_preferences` is tenant-produced.
  protected override readonly placement: Placement = "routed";

  // One statement for N users. A delivery fanning out to a hundred recipients would
  // otherwise be a hundred round trips before it writes anything.
  public async findFor(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    category: NotificationCategory,
  ): Promise<readonly PreferenceRecord[]> {
    if (userIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.organizationId, organizationId),
          inArray(notificationPreferences.userId, [...userIds]),
          eq(notificationPreferences.category, category),
        ),
      );

    return rows.map((row) => PgNotificationPreferenceRepository.toRecord(row));
  }

  public async listFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly PreferenceRecord[]> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.organizationId, organizationId),
          eq(notificationPreferences.userId, userId),
        ),
      );

    return rows.map((row) => PgNotificationPreferenceRepository.toRecord(row));
  }

  // Upsert on the unique index, so setting the same preference twice is one row rather
  // than a conflict the caller has to catch.
  public async save(
    organizationId: OrganizationId,
    userId: UserId,
    preference: Omit<PreferenceRecord, "userId">,
  ): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({
        id: Uuid.v7(),
        organizationId,
        userId,
        category: preference.category,
        channel: preference.channel,
        mode: preference.mode,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.organizationId,
          notificationPreferences.userId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: { mode: preference.mode, updatedAt: sql`now()` },
      });
  }

  private static toRecord(row: typeof notificationPreferences.$inferSelect): PreferenceRecord {
    return {
      userId: row.userId,
      category: row.category as PreferenceRecord["category"],
      channel: row.channel as PreferenceRecord["channel"],
      mode: row.mode as PreferenceRecord["mode"],
    };
  }
}
