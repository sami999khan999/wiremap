import { Identifiers, type InvitationId } from "@loadbearing/contracts";
import { FixedClock } from "@loadbearing/core";
import { ForbiddenError, NotFoundError, UnavailableError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { InvitationMail, InvitationMailer } from "../../src/member/invitation.mailer.js";
import type {
  InvitationPage,
  InvitationRecord,
  InvitationRepository,
  NewInvitation,
} from "../../src/member/invitation.repository.js";
import { ResendInvitationUseCase } from "../../src/member/resend-invitation.use-case.js";
import type { ActivityLogger, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER_ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000b0");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1");
const INVITATION = Identifiers.invitationId.parse("018f8c00-0000-7000-8000-0000000000d1");

const CREATED = new Date("2026-08-20T09:00:00.000Z");
const NOW = new Date("2026-09-03T12:00:00.000Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const ORIGINAL_HASH = "the-hash-the-first-token-made";

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

// Holds one invitation, in whichever tenant it was built for, and records every save so
// the reissue can be read back field by field.
class RecordingInvitationRepository implements InvitationRepository {
  public readonly saved: NewInvitation[] = [];

  public constructor(private readonly organizationId: string = ORG) {}

  public list(): Promise<InvitationPage> {
    throw new Error("not under test");
  }

  public findById(organizationId: string, id: InvitationId): Promise<InvitationRecord | null> {
    if (organizationId !== this.organizationId || id !== INVITATION) return Promise.resolve(null);

    return Promise.resolve({
      id: INVITATION,
      email: "grace@example.test",
      roleId: ROLE,
      roleName: "Member",
      invitedBy: USER,
      inviterName: "Ada",
      organizationName: "Acme",
      expiresAt: new Date(CREATED.getTime() + WEEK_MS),
      createdAt: CREATED,
    });
  }

  public save(invitation: NewInvitation): Promise<void> {
    this.saved.push(invitation);
    return Promise.resolve();
  }

  public delete(): Promise<void> {
    throw new Error("not under test");
  }
}

class RecordingMailer implements InvitationMailer {
  public readonly sent: InvitationMail[] = [];
  public failing = false;

  public send(mail: InvitationMail): Promise<void> {
    if (this.failing) return Promise.reject(new UnavailableError("smtp"));
    this.sent.push(mail);
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

const harness = (tenant: string = ORG) => {
  const invitations = new RecordingInvitationRepository(tenant);
  const mailer = new RecordingMailer();
  const activity = new RecordingActivityLogger();

  return {
    invitations,
    mailer,
    activity,
    useCase: new ResendInvitationUseCase(
      new Authorizer(),
      invitations,
      mailer,
      activity,
      new DirectUnitOfWork(),
      new FixedClock(NOW),
    ),
  };
};

describe("ResendInvitationUseCase", () => {
  it("refuses an actor without `member.invite`", async () => {
    await expect(
      harness().useCase.execute(actorHolding("member.read"), { invitationId: INVITATION }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Looked up under the actor's tenant, so an id from another organization is not found
  // rather than resent to somebody else's invitee.
  it("does not find an invitation belonging to another tenant", async () => {
    await expect(
      harness(OTHER_ORG).useCase.execute(actorHolding("member.invite"), {
        invitationId: INVITATION,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // The point of the whole action: only the digest is stored, so the original token
  // cannot be read back and the row has to take a new one.
  it("issues a new token and a new digest", async () => {
    const { useCase, invitations, mailer } = harness();
    await useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION });

    const saved = invitations.saved[0];
    expect(saved?.tokenHash).toBeDefined();
    expect(saved?.tokenHash).not.toBe(ORIGINAL_HASH);
    expect(mailer.sent[0]?.token).toBeDefined();
    // The token goes to the mailbox and the digest to the table. Neither is the other.
    expect(mailer.sent[0]?.token).not.toBe(saved?.tokenHash);
  });

  it("extends the window from now, and keeps the row's original `createdAt`", async () => {
    const { useCase, invitations } = harness();
    const result = await useCase.execute(actorHolding("member.invite"), {
      invitationId: INVITATION,
    });

    expect(invitations.saved[0]?.expiresAt.getTime()).toBe(NOW.getTime() + WEEK_MS);
    expect(invitations.saved[0]?.createdAt).toEqual(CREATED);
    // Returned too, so the list the mutation invalidates is not the only way to see it.
    expect(result.expiresAt.getTime()).toBe(NOW.getTime() + WEEK_MS);
  });

  it("keeps the invitation's id, email, role and inviter", async () => {
    const { useCase, invitations } = harness();
    await useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION });

    expect(invitations.saved[0]).toMatchObject({
      id: INVITATION,
      organizationId: ORG,
      email: "grace@example.test",
      roleId: ROLE,
      invitedBy: USER,
    });
  });

  it("records the resend as its own action, not as a second invitation", async () => {
    const { useCase, activity } = harness();
    await useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION });

    expect(activity.records.map((row) => row.action)).toEqual(["member.invitation.resent"]);
  });

  // **The difference from `InviteMemberUseCase`**, which swallows a send failure: there
  // the mail is a consequence of the work, and here it is the work.
  it("throws when the mail cannot be enqueued", async () => {
    const { useCase, mailer } = harness();
    mailer.failing = true;

    await expect(
      useCase.execute(actorHolding("member.invite"), { invitationId: INVITATION }),
    ).rejects.toBeInstanceOf(UnavailableError);
  });
});
