import {
  type AiSettingsRecord,
  type AiSettingsRepository,
  eq,
  type OrganizationId,
  type Placement,
  sql,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizationAi } from "../schema/index.js";

export class PgAiSettingsRepository extends BaseRepository implements AiSettingsRepository {
  protected override readonly placement: Placement = "catalog";

  public async find(organizationId: OrganizationId): Promise<AiSettingsRecord | null> {
    const [row] = await this.db
      .select({
        enabled: organizationAi.enabled,
        provider: organizationAi.provider,
        model: organizationAi.model,
        encryptedKey: organizationAi.encryptedKey,
        keyHint: organizationAi.keyHint,
      })
      .from(organizationAi)
      .where(eq(organizationAi.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  public async save(organizationId: OrganizationId, settings: AiSettingsRecord): Promise<void> {
    await this.db
      .insert(organizationAi)
      .values({ organizationId, ...settings })
      .onConflictDoUpdate({
        target: organizationAi.organizationId,
        set: { ...settings, updatedAt: sql`now()` },
      });
  }
}
