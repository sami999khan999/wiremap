import type { OrganizationId, UserId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { InvitationClaimer, type InvitationPreview } from "../../src/session/invitation.claimer.js";
import { InvitationClaimingEnroller } from "../../src/session/invitation-claiming.enroller.js";
import { MembershipEnroller } from "../../src/session/membership.enroller.js";

const USER = "018f8c00-0000-7000-8000-000000000011" as UserId;
const INVITED_ORG = "018f8c00-0000-7000-8000-0000000000a1" as OrganizationId;
const PERSONAL_ORG = "018f8c00-0000-7000-8000-0000000000b2" as OrganizationId;

class StubClaimer extends InvitationClaimer {
  public readonly pendingCalls: UserId[] = [];

  public constructor(private readonly answer: OrganizationId | null) {
    super();
  }

  public override preview(): Promise<InvitationPreview | null> {
    throw new Error("not under test");
  }

  public override claimByToken(): Promise<OrganizationId | null> {
    throw new Error("not under test");
  }

  public override claimPending(userId: UserId): Promise<OrganizationId | null> {
    this.pendingCalls.push(userId);
    return Promise.resolve(this.answer);
  }
}

class RecordingEnroller extends MembershipEnroller {
  public readonly calls: UserId[] = [];

  public constructor(private readonly answer: OrganizationId | null) {
    super();
  }

  public override enrol(userId: UserId): Promise<OrganizationId | null> {
    this.calls.push(userId);
    return Promise.resolve(this.answer);
  }
}

describe("InvitationClaimingEnroller", () => {
  // The tenancy decision in one assertion: an invited address joins the inviting
  // organization and the wrapped mode never runs, so no personal organization exists.
  it("returns the claimed organization and never consults the inner enroller", async () => {
    const claimer = new StubClaimer(INVITED_ORG);
    const inner = new RecordingEnroller(PERSONAL_ORG);

    const result = await new InvitationClaimingEnroller(claimer, inner).enrol(USER);

    expect(result).toBe(INVITED_ORG);
    expect(claimer.pendingCalls).toEqual([USER]);
    expect(inner.calls).toEqual([]);
  });

  it("falls through to the inner enroller when nothing was pending", async () => {
    const inner = new RecordingEnroller(PERSONAL_ORG);

    const result = await new InvitationClaimingEnroller(new StubClaimer(null), inner).enrol(USER);

    expect(result).toBe(PERSONAL_ORG);
    expect(inner.calls).toEqual([USER]);
  });

  // Around `NullMembershipEnroller` this is `invite` mode: no invitation, no membership,
  // and the session hook refuses — the fail-closed answer the port promises.
  it("stays null when neither the claim nor the inner enroller produced a tenant", async () => {
    const result = await new InvitationClaimingEnroller(
      new StubClaimer(null),
      new RecordingEnroller(null),
    ).enrol(USER);

    expect(result).toBeNull();
  });
});
