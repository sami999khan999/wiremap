import { SessionGateway, type UserId } from "../import.js";

// Records who was signed out, in order: the assertion worth writing is that the suspend
// revoked this person's sessions, and only after it committed.
export class RecordingSessionGateway extends SessionGateway {
  private readonly revocations: UserId[] = [];

  public override revokeAll(userId: UserId): Promise<void> {
    this.revocations.push(userId);
    return Promise.resolve();
  }

  public revoked(): readonly UserId[] {
    return this.revocations;
  }
}
