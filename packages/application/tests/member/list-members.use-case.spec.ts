import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type {
  InvitationPage,
  InvitationRepository,
} from "../../src/member/invitation.repository.js";
import { ListInvitationsUseCase } from "../../src/member/list-invitations.use-case.js";
import { ListMembersUseCase } from "../../src/member/list-members.use-case.js";
import type {
  MemberPage,
  MemberRecord,
  MemberRepository,
} from "../../src/member/member.repository.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

class RecordingMemberRepository implements MemberRepository {
  public readonly calls: { organizationId: string; limit: number; offset: number }[] = [];

  public list(
    organizationId: string,
    page: { limit: number; offset: number },
  ): Promise<MemberPage> {
    this.calls.push({ organizationId, limit: page.limit, offset: page.offset });
    return Promise.resolve({ items: [], total: 0 });
  }

  public existsByEmail(): Promise<boolean> {
    throw new Error("not under test");
  }

  public findByUser(): Promise<MemberRecord | null> {
    throw new Error("not under test");
  }

  public changeRole(): Promise<void> {
    throw new Error("not under test");
  }

  public setDeactivatedAt(): Promise<void> {
    throw new Error("not under test");
  }

  public countActiveHolders(): Promise<number> {
    throw new Error("not under test");
  }

  public lockActiveHolders(): Promise<number> {
    throw new Error("not under test");
  }
}

class RecordingInvitationRepository implements InvitationRepository {
  public readonly calls: { organizationId: string; limit: number; offset: number }[] = [];

  public list(
    organizationId: string,
    page: { limit: number; offset: number },
  ): Promise<InvitationPage> {
    this.calls.push({ organizationId, limit: page.limit, offset: page.offset });
    return Promise.resolve({ items: [], total: 0 });
  }

  public findById(): Promise<null> {
    throw new Error("not under test");
  }

  public save(): Promise<void> {
    throw new Error("not under test");
  }

  public delete(): Promise<void> {
    throw new Error("not under test");
  }
}

// Both reads are gated on the same key and shaped the same way, so one file pins both.
describe("ListMembersUseCase and ListInvitationsUseCase", () => {
  it("refuse a principal without member.read", async () => {
    const members = new RecordingMemberRepository();
    const invitations = new RecordingInvitationRepository();

    await expect(
      new ListMembersUseCase(new Authorizer(), members).execute(actorHolding(), {
        limit: 25,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      new ListInvitationsUseCase(new Authorizer(), invitations).execute(actorHolding(), {
        limit: 25,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(members.calls).toEqual([]);
    expect(invitations.calls).toEqual([]);
  });

  it("read under the actor's tenant and echo the page back", async () => {
    const members = new RecordingMemberRepository();
    const invitations = new RecordingInvitationRepository();
    const actor = actorHolding("member.read");

    const memberPage = await new ListMembersUseCase(new Authorizer(), members).execute(actor, {
      limit: 10,
      offset: 20,
    });
    const invitationPage = await new ListInvitationsUseCase(new Authorizer(), invitations).execute(
      actor,
      { limit: 5, offset: 0 },
    );

    expect(members.calls).toEqual([{ organizationId: ORG, limit: 10, offset: 20 }]);
    expect(invitations.calls).toEqual([{ organizationId: ORG, limit: 5, offset: 0 }]);
    expect(memberPage).toEqual({ items: [], total: 0, limit: 10, offset: 20 });
    expect(invitationPage).toEqual({ items: [], total: 0, limit: 5, offset: 0 });
  });
});
