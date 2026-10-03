import { describe, expect, it } from "vitest";
import { MemberContract, type MemberDto } from "../../src/member/member.contract.js";
import { MemberEntity } from "../../src/member/member.entity.js";
import { MemberProcedures } from "../../src/member/member.procedures.js";
import { Identifiers } from "../../src/primitive/index.js";

const VALID: MemberDto = {
  userId: Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011"),
  name: "Ada",
  email: "ada@example.test",
  roleId: Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1"),
  roleKey: "owner",
  roleName: "Owner",
  joinedAt: new Date("2026-09-03T00:00:00Z"),
  deactivated: false,
  suspended: false,
  exceptions: 0,
};

describe("MemberContract", () => {
  it("keeps dates as dates rather than strings", () => {
    // The RPC link serialises `Date` natively, so the shape the repository returns is
    // the shape a component renders — no ISO round trip in between.
    expect(MemberContract.entity.parse(VALID).joinedAt).toBeInstanceOf(Date);
    expect(() => MemberContract.entity.parse({ ...VALID, joinedAt: "2026-09-03" })).toThrow();
  });

  it("validates the invited address as an email and brands the role", () => {
    expect(() =>
      MemberContract.invite.parse({ email: "not-an-email", roleId: VALID.roleId }),
    ).toThrow();
    expect(() => MemberContract.invite.parse({ email: "b@example.test", roleId: "x" })).toThrow();
    expect(
      MemberContract.invite.parse({ email: "B@Example.test", roleId: VALID.roleId }).email,
    ).toBe(
      // Not lowercased here, on purpose: the use-case does it, once.
      "B@Example.test",
    );
  });

  it("never describes a token on the wire", () => {
    expect(Object.keys(MemberContract.invitation.shape)).not.toContain("token");
  });

  it("caps the list query in the schema rather than in a handler", () => {
    expect(() => MemberContract.listQuery.parse({ limit: 1000, offset: 0 })).toThrow();
    expect(MemberContract.listQuery.parse({}).limit).toBe(25);
  });

  it("mounts every procedure the permission catalog names", () => {
    expect(Object.keys(MemberProcedures.all).sort()).toEqual([
      "addDomain",
      "changeRole",
      "createLink",
      "deactivate",
      "invite",
      "list",
      "listDomains",
      "listInvitations",
      "listLinks",
      "reactivate",
      "remove",
      "removeDomain",
      "resendInvitation",
      "revokeInvitation",
      "revokeLink",
    ]);
  });
});

describe("MemberEntity", () => {
  it("recognises the wildcard role and an active membership", () => {
    const owner = MemberEntity.from(VALID);
    const guest = MemberEntity.from({ ...VALID, roleKey: "guest", deactivated: true });

    expect(owner.isOwner).toBe(true);
    expect(owner.active).toBe(true);
    expect(guest.isOwner).toBe(false);
    expect(guest.active).toBe(false);
    expect(owner.label).toBe("Ada");
  });
});
