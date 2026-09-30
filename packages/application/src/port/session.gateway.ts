import type { UserId } from "../import.js";

// The write side of sessions. A suspend without it waits out each session's lifetime,
// because the membership readers refuse a principal but never end the session itself.
export abstract class SessionGateway {
  // Every device at once, the cached copy included. Called after the commit that
  // suspended the account, so a rolled-back suspend signs nobody out.
  public abstract revokeAll(userId: UserId): Promise<void>;
}
