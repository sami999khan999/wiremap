import { ValidationError } from "../import.js";
import type { ActivityLogger, SecretCipher, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { AiSettingsRecord, AiSettingsRepository } from "./ai-settings.repository.js";
import type { ChatProvider } from "./chat-provider.js";

export interface AiSettingsView {
  readonly enabled: boolean;
  readonly provider: "none" | "gemini";
  readonly model: string;
  readonly keyHint: string | null;
}

// The organization's own model key: written encrypted, shown as its last four characters,
// never read back. With no key, or the provider `none`, Ask is off.
export class ManageAiSettingsUseCase {
  public static readonly DEFAULT_MODEL = "gemini-2.5-flash";

  public constructor(
    private readonly authorizer: Authorizer,
    private readonly settings: AiSettingsRepository,
    private readonly cipher: SecretCipher,
    private readonly chat: ChatProvider,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async get(actor: Principal): Promise<AiSettingsView> {
    this.authorizer.assert(actor, "organization.ai.manage");
    return ManageAiSettingsUseCase.view(await this.settings.find(actor.organizationId));
  }

  public async update(
    actor: Principal,
    input: {
      readonly enabled: boolean;
      readonly provider: "none" | "gemini";
      readonly model: string;
      readonly apiKey?: string | null | undefined;
    },
  ): Promise<AiSettingsView> {
    this.authorizer.assert(actor, "organization.ai.manage");
    const current = await this.settings.find(actor.organizationId);
    const key = input.apiKey === undefined ? undefined : input.apiKey;
    const next: AiSettingsRecord = {
      enabled: input.enabled,
      provider: input.provider,
      model: input.model,
      encryptedKey:
        key === undefined
          ? (current?.encryptedKey ?? null)
          : key === null
            ? null
            : this.cipher.encrypt(key),
      keyHint:
        key === undefined
          ? (current?.keyHint ?? null)
          : key === null
            ? null
            : `••••${key.slice(-4)}`,
    };
    if (next.enabled && next.provider !== "none" && !next.encryptedKey) {
      throw new ValidationError([{ field: "apiKey", rule: "required" }]);
    }
    await this.unitOfWork.run(async () => {
      await this.settings.save(actor.organizationId, next);
      // What changed, never the key: an audit trail is read by more people than the key is.
      await this.activity.record(actor, "ai.settings.updated", {
        enabled: next.enabled,
        provider: next.provider,
        model: next.model,
        keyChanged: key !== undefined,
      });
    });
    return ManageAiSettingsUseCase.view(next);
  }

  public async test(actor: Principal): Promise<{ readonly ok: boolean }> {
    this.authorizer.assert(actor, "organization.ai.manage");
    const settings = await this.settings.find(actor.organizationId);
    if (!settings?.encryptedKey || settings.provider === "none") return { ok: false };
    return { ok: await this.chat.test(this.cipher.decrypt(settings.encryptedKey), settings.model) };
  }

  // On for this organization: enabled, a provider, and a key.
  public async available(actor: Principal): Promise<{ readonly available: boolean }> {
    const settings = await this.settings.find(actor.organizationId);
    return {
      available: Boolean(
        settings?.enabled && settings.provider !== "none" && settings.encryptedKey,
      ),
    };
  }

  private static view(record: AiSettingsRecord | null): AiSettingsView {
    return {
      enabled: record?.enabled ?? false,
      provider: record?.provider ?? "none",
      model: record?.model ?? ManageAiSettingsUseCase.DEFAULT_MODEL,
      keyHint: record?.keyHint ?? null,
    };
  }
}
