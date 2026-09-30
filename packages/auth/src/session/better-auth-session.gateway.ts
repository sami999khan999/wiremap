import type { AuthInstance } from "../factory/index.js";
import { SessionGateway, type UserId } from "../import.js";

// Through Better Auth's own adapter, never `DELETE FROM sessions`: a raw delete leaves the
// secondary-storage copy in Redis, and that copy keeps answering until its TTL.
export class BetterAuthSessionGateway extends SessionGateway {
  public constructor(private readonly auth: AuthInstance) {
    super();
  }

  public override async revokeAll(userId: UserId): Promise<void> {
    const context = await this.auth.$context;
    await context.internalAdapter.deleteUserSessions(userId);
  }
}
