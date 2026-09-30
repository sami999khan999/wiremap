import type { OrganizationId, UserId } from "../import.js";

// Structurally satisfied by a Web `Headers`. Declared rather than named: borrowing one
// from @types/node would put Node's globals in a runtime-neutral package.
export interface RequestHeaders {
  get(name: string): string | null;
}

// The session carries its organization: `PrincipalBuilder` is handed headers and nothing
// else, and resolving it per request is a membership query on every call.
export interface ResolvedSession {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export abstract class SessionResolver {
  public abstract resolve(headers: RequestHeaders): Promise<ResolvedSession | null>;
}
