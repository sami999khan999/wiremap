import type { OrganizationId, UserId } from "../import.js";
import { MembershipEnroller } from "./membership.enroller.js";

// The `invite` mode: nobody enrols themselves. Beside its port rather than in
// `infrastructure` because it touches no database.
export class NullMembershipEnroller extends MembershipEnroller {
  // Null on every call, which the session hook turns into a refused sign-in. A real
  // implementation rather than a missing binding, so the refusal is fail-closed.
  public override enrol(_userId: UserId): Promise<OrganizationId | null> {
    return Promise.resolve(null);
  }
}
