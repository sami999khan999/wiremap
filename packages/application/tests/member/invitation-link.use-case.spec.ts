import { Identifiers } from "@loadbearing/contracts";
import { Token } from "@loadbearing/core";
import { ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { CreateInvitationLinkUseCase } from "../../src/member/create-invitation-link.use-case.js";
import {
  type InvitationLinkRecord,
  InvitationLinkRepository,
  type NewInvitationLink,
} from "../../src/member/invitation-link.repository.js";
import { RevokeInvitationLinkUseCase } from "../../src/member/revoke-invitation-link.use-case.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import {
  ACTOR,
  CLOCK,
  DirectUnitOfWork,
  holding,
  MEMBER_ROLE,
  RecordingActivity,
  stubRoles,
  unlimited,
} from "../support/wiremap-fakes.js";

class MemoryLinks extends InvitationLinkRepository {
  public readonly saved: NewInvitationLink[] = [];
  public readonly revoked: string[] = [];
  public list() {
    return Promise.resolve({ items: [], total: 0 });
  }
  public findById(_org: unknown, id: string): Promise<InvitationLinkRecord | null> {
    const link = this.saved.find((candidate) => candidate.id === id);
    if (!link) return Promise.resolve(null);
    return Promise.resolve({
      id: link.id,
      roleId: link.roleId,
      roleName: "member",
      createdBy: link.createdBy,
      creatorName: "Ada",
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      uses: 0,
      createdAt: CLOCK.now(),
    });
  }
  public save(_org: unknown, link: NewInvitationLink) {
    this.saved.push(link);
    return Promise.resolve();
  }
  public revoke(_org: unknown, id: string) {
    this.revoked.push(id);
    return Promise.resolve();
  }
}

describe("CreateInvitationLinkUseCase", () => {
  it("stores only the token's digest and hands the token back once", async () => {
    const links = new MemoryLinks();
    const activity = new RecordingActivity();
    const useCase = new CreateInvitationLinkUseCase(
      new Authorizer(),
      links,
      stubRoles(),
      unlimited,
      activity,
      new DirectUnitOfWork(),
      CLOCK,
    );

    const created = await useCase.execute(holding("member.invite", "member.read"), {
      roleId: MEMBER_ROLE,
      expiresInDays: 7,
      maxUses: 10,
    });

    expect(links.saved[0]?.tokenHash).toBe(await Token.hash(created.token));
    expect(links.saved[0]?.tokenHash).not.toBe(created.token);
    expect(created.expiresAt.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(created.createdBy).toBe(ACTOR);
    expect(activity.actions()).toEqual(["member.link.created"]);
  });

  it("refuses a principal without member.invite", async () => {
    const useCase = new CreateInvitationLinkUseCase(
      new Authorizer(),
      new MemoryLinks(),
      stubRoles(),
      unlimited,
      new RecordingActivity(),
      new DirectUnitOfWork(),
      CLOCK,
    );

    await expect(
      useCase.execute(holding("member.read"), {
        roleId: MEMBER_ROLE,
        expiresInDays: 7,
        maxUses: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("RevokeInvitationLinkUseCase", () => {
  it("answers NOT_FOUND for a link this tenant does not have", async () => {
    const useCase = new RevokeInvitationLinkUseCase(
      new Authorizer(),
      new MemoryLinks(),
      new RecordingActivity(),
      new DirectUnitOfWork(),
      CLOCK,
    );

    await expect(
      useCase.execute(holding("member.invite"), {
        linkId: Identifiers.invitationLinkId.parse("018f8c00-0000-7000-8000-0000000000ff"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
