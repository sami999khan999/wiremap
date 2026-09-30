import type { OrganizationId, UserId } from "../import.js";

// The write half of the pair `MembershipReader` reads, and the only thing that inserts
// into `memberships`. See docs/reference/enrolment.md.
export abstract class MembershipEnroller {
  // Null is not an error: registration switched off returns it on every sign-up, and the
  // session is then refused. Fail-closed is the whole point.
  public abstract enrol(userId: UserId): Promise<OrganizationId | null>;
}
