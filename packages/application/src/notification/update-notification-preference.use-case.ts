import type { UpdateNotificationPreferenceInput } from "../import.js";
import type { UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { NotificationPreferenceRepository } from "./notification-preference.repository.js";

export class UpdateNotificationPreferenceUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly preferences: NotificationPreferenceRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  // Always the actor's own. There is no administrator override here: choosing how you
  // are contacted is yours, and an input carrying a userId would be the hole.
  public async execute(actor: Principal, input: UpdateNotificationPreferenceInput): Promise<void> {
    this.authorizer.assert(actor, "notification.preference.update");

    // In a unit of work for the move freeze, which is enforced there and nowhere else: a
    // routed write outside one landed on the source during a move and was lost (`CR.11`).
    await this.unitOfWork.run(() =>
      this.preferences.save(actor.organizationId, actor.userId, input),
    );
  }
}
