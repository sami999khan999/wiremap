import type { OrganizationId } from "../import.js";

export interface AiSettingsRecord {
  readonly enabled: boolean;
  readonly provider: "none" | "gemini";
  readonly model: string;
  // `SecretCipher` output; never decrypted except to call the provider.
  readonly encryptedKey: string | null;
  readonly keyHint: string | null;
}

// One row per organization, in the catalog with the rest of its configuration.
export abstract class AiSettingsRepository {
  public abstract find(organizationId: OrganizationId): Promise<AiSettingsRecord | null>;

  public abstract save(organizationId: OrganizationId, settings: AiSettingsRecord): Promise<void>;
}
