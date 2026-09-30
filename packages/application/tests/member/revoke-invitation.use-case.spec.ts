import { Identifiers, type InvitationId } from "@loadbearing/contracts";
import { ForbiddenError, NotFoundError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type {
  InvitationPage,
  InvitationRecord,
  InvitationRepository,
} from "../../src/member/invitation.repository.js";
import { RevokeInvitationUseCase } from "../../src/member/revoke-invitation.use-case.js";
import type { ActivityLogger, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER_ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000b0");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const INVITATION = Identifiers.invitationId.parse("018f8c00-0000-7000-8000-0000000000d1");

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

// Holds one invitation, under one tenant. `findById` answers only for that tenant —
// which is the property the "another tenant's id" test pins.
class RecordingInvitationRepository implements InvitationRepository {
  public readonly deleted: { organizationId: string; id: InvitationId }[] = [];

  public constructor(private readonly tenant: string) {}

  public list(): Promise<InvitationPage> {
    throw new Error("not under test");
  }

  public findById(organizationId: string, id: InvitationId): Promise<InvitationRecord | null> {
    if (organizationId !== this.tenant || id !== INVITATION) return Promise.resolve(null);
    return Promise.resolve({
      id,
      email: "b@example.test",
      roleId: Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1"),
      roleName: "Member",
      invitedBy: USER,
      inviterName: "Ada",
      organizationName: "Acme",
      expiresAt: new Date("2026-09-10T00:00:00Z"),
      createdAt: new Date("2026-09-03T00:00:00Z"),
    });
  }

  public save(): Promise<void> {
    throw new Error("not under test");
  }

  public delete(organizationId: string, id: InvitationId): Promise<void> {
    this.deleted.push({ organizationId, id });
    return Promise.resolve();
  }
}

class RecordingActivityLogger implements ActivityLogger {
  public readonly records: { action: string; payload: Record<string, unknown> }[] = [];

  public record(
    _actor: Principal,
    action: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    this.records.push({ action, payload: { ...payload } });
    return Promise.resolve();
  }
}

class DirectUnitOfWork implements UnitOfWork {
  public run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

describe("RevokeInvitationUseCase", () => {
  it("refuses a principal without member.invite", async () => {
    const invitations = new RecordingInvitationRepository(ORG);
    const useCase = new RevokeInvitationUseCase(
      new Authorizer(),
      invitations,
      new RecordingActivityLogger(),
      new DirectUnitOfWork(),
    );

    await expect(
      useCase.execute(actorHolding("member.read"), { invitationId: INVITATION }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(invitations.deleted).toEqual([]);
  });

  it("does not find an invitation that belongs to another tenant", async () => {
    const invitations = new RecordingInvitationRepository(OTHER_ORG);
    const useCase = new RevokeInvitationUseCase(
      new Authorizer(),
      invitations,
      new RecordingActivityLogger(),
      new DirectUnitOfWork(),
    );

    await expect(
      useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(invitations.deleted).toEqual([]);
  });

  it("deletes under the actor's tenant and audits the address it revoked", async () => {
    const invitations = new RecordingInvitationRepository(ORG);
    const activity = new RecordingActivityLogger();
    const useCase = new RevokeInvitationUseCase(
      new Authorizer(),
      invitations,
      activity,
      new DirectUnitOfWork(),
    );

    await useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION });

    expect(invitations.deleted).toEqual([{ organizationId: ORG, id: INVITATION }]);
    expect(activity.records).toEqual([
      {
        action: "member.invitation.revoked",
        payload: { invitationId: INVITATION, email: "b@example.test" },
      },
    ]);
  });
});
