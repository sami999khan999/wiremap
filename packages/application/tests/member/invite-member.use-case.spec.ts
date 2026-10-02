import type { DomainEventInput } from "@loadbearing/contracts";
import { Identifiers, type InvitationId, type RoleId } from "@loadbearing/contracts";
import { FixedClock, Token } from "@loadbearing/core";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
} from "@loadbearing/errors";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import type { InvitationMail, InvitationMailer } from "../../src/member/invitation.mailer.js";
import type {
  InvitationPage,
  InvitationRecord,
  InvitationRepository,
  NewInvitation,
} from "../../src/member/invitation.repository.js";
import { InviteMemberUseCase } from "../../src/member/invite-member.use-case.js";
import type {
  MemberPage,
  MemberRecord,
  MemberRepository,
} from "../../src/member/member.repository.js";
import type { ActivityLogger, DomainEventPublisher, UnitOfWork } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import type { CapabilityRepository } from "../../src/rbac/capability.repository.js";
import type { RolePage, RoleRecord, RoleRepository } from "../../src/rbac/role.repository.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER_ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000b0");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1");
// A goal role belongs on `goal_members`, never on a membership.
const GOAL_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c3");
const NOW = new Date("2026-09-03T12:00:00.000Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

const memberRole = (organizationId: string): RoleRecord => ({
  id: ROLE,
  key: "member",
  name: "Member",
  description: null,
  scope: "org",
  isSystem: true,
  permissions: ["member.read"],
  ...(organizationId === ORG ? {} : {}),
});

// Answers only for the tenant it was built with, which is what the "wrong tenant"
// test below depends on.
class StubRoleRepository implements RoleRepository {
  public constructor(private readonly organizationId: string) {}

  public list(): Promise<RolePage> {
    throw new Error("not under test");
  }

  public findById(organizationId: string, roleId: RoleId): Promise<RoleRecord | null> {
    if (organizationId !== this.organizationId) return Promise.resolve(null);
    if (roleId === GOAL_ROLE) {
      return Promise.resolve({ ...memberRole(organizationId), id: GOAL_ROLE, scope: "goal" });
    }
    return Promise.resolve(roleId === ROLE ? memberRole(organizationId) : null);
  }

  public findByKey(): Promise<RoleRecord | null> {
    throw new Error("not under test");
  }

  public save(): Promise<void> {
    throw new Error("not under test");
  }

  public delete(): Promise<void> {
    throw new Error("not under test");
  }

  public countAssignments(): Promise<number> {
    throw new Error("not under test");
  }
  public savePermission(): Promise<void> {
    throw new Error("not under test");
  }

  public deletePermission(): Promise<void> {
    throw new Error("not under test");
  }
}

class StubMemberRepository implements MemberRepository {
  public constructor(private readonly existing: readonly string[] = []) {}

  public list(): Promise<MemberPage> {
    throw new Error("not under test");
  }

  public existsByEmail(_organizationId: string, email: string): Promise<boolean> {
    return Promise.resolve(this.existing.includes(email));
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
  public readonly saved: NewInvitation[] = [];

  public list(): Promise<InvitationPage> {
    throw new Error("not under test");
  }

  public findById(organizationId: string, id: InvitationId): Promise<InvitationRecord | null> {
    const row = this.saved.find((i) => i.id === id && i.organizationId === organizationId);
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      id: row.id,
      email: row.email,
      roleId: row.roleId,
      roleName: "Member",
      invitedBy: row.invitedBy,
      inviterName: "Ada",
      organizationName: "Acme",
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
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

class RecordingDomainEventPublisher implements DomainEventPublisher {
  public readonly published: { name: string; payload: Record<string, unknown> }[] = [];

  public publish(_actor: Principal, event: DomainEventInput): Promise<void> {
    this.published.push({ name: event.name, payload: { ...event.payload } });
    return Promise.resolve();
  }
}

class DirectUnitOfWork implements UnitOfWork {
  public run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class FailingUnitOfWork implements UnitOfWork {
  public run<T>(): Promise<T> {
    return Promise.reject(new Error("commit failed"));
  }
}

interface Harness {
  readonly useCase: InviteMemberUseCase;
  readonly invitations: RecordingInvitationRepository;
  readonly mailer: RecordingMailer;
  readonly activity: RecordingActivityLogger;
  readonly events: RecordingDomainEventPublisher;
}

function harness(
  options: { existing?: readonly string[]; roleTenant?: string; unitOfWork?: UnitOfWork } = {},
): Harness {
  const invitations = new RecordingInvitationRepository();
  const mailer = new RecordingMailer();
  const activity = new RecordingActivityLogger();
  const events = new RecordingDomainEventPublisher();
  const useCase = new InviteMemberUseCase(
    new Authorizer(),
    new StubRoleRepository(options.roleTenant ?? ORG),
    new StubMemberRepository(options.existing),
    invitations,
    mailer,
    activity,
    events,
    options.unitOfWork ?? new DirectUnitOfWork(),
    new FixedClock(NOW),
    {
      entitlementFor: () =>
        Promise.resolve(
          EntitlementMask.from({ plan: "all", added: [], removed: [], disabledModules: [] }),
        ),
    } as unknown as CapabilityRepository,
  );
  return { useCase, invitations, mailer, activity, events };
}

describe("InviteMemberUseCase", () => {
  it("refuses a principal without member.invite before touching anything", async () => {
    const h = harness();

    await expect(
      h.useCase.execute(actorHolding("member.read"), { email: "b@example.test", roleId: ROLE }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(h.invitations.saved).toEqual([]);
    expect(h.mailer.sent).toEqual([]);
  });

  // `CR.1`: `admin` holds `member.invite`, and an invitation onto `owner` was a takeover.
  it("refuses a role granting a key the actor does not hold, and saves nothing", async () => {
    const h = harness();

    await expect(
      h.useCase.execute(actorHolding("member.invite"), { email: "b@example.test", roleId: ROLE }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.invitations.saved).toEqual([]);
  });

  // A role id from another organization parses just as well; the lookup under the
  // actor's tenant is what stops it being handed out.
  it("refuses a role that belongs to another tenant", async () => {
    const h = harness({ roleTenant: OTHER_ORG });

    await expect(
      h.useCase.execute(actorHolding("member.invite"), { email: "b@example.test", roleId: ROLE }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses an address that already belongs to a member", async () => {
    const h = harness({ existing: ["b@example.test"] });

    await expect(
      h.useCase.execute(actorHolding("member.invite", "member.read"), {
        email: "B@Example.test",
        roleId: ROLE,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("saves a lowercased row expiring in seven days, audits it, then mails the link", async () => {
    const h = harness();

    const result = await h.useCase.execute(actorHolding("member.invite", "member.read"), {
      email: "  B@Example.test ",
      roleId: ROLE,
    });

    expect(h.invitations.saved).toHaveLength(1);
    const saved = h.invitations.saved[0];
    expect(saved).toMatchObject({
      organizationId: ORG,
      email: "b@example.test",
      roleId: ROLE,
      invitedBy: USER,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + WEEK_MS),
    });
    expect(saved?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(h.activity.records).toEqual([
      { action: "member.invited", payload: { email: "b@example.test", roleId: ROLE } },
    ]);

    // Beside the audit row and inside the same unit of work. Audit is the human fact and
    // the outbox is the integration fact, and they commit together or not at all.
    expect(h.events.published).toEqual([
      {
        name: "member.invited",
        payload: {
          invitationId: saved?.id,
          email: "b@example.test",
          roleId: ROLE,
          invitedBy: USER,
        },
      },
    ]);

    // The mail carries the token; the row carries its digest. Neither is the other, and
    // that pairing is the whole of the change that stopped storing bearer tokens.
    const [mail] = h.mailer.sent;
    expect(mail).toMatchObject({
      to: "b@example.test",
      // The one mail that belongs to a tenant, and the field is how the pipeline says so.
      organizationId: ORG,
      organizationName: "Acme",
      inviterName: "Ada",
    });
    expect(mail?.token).toMatch(/^[0-9a-f]{64}$/);
    // The token reaches the mailbox and never the event: that is what `token_hash` is for.
    expect(JSON.stringify(h.events.published)).not.toContain(mail?.token);
    expect(mail?.token).not.toBe(saved?.tokenHash);
    expect(saved?.tokenHash).toBe(await Token.hash(mail?.token ?? ""));

    expect(result.email).toBe("b@example.test");
    expect(result.roleName).toBe("Member");
    // Neither the token nor its digest reaches the caller.
    expect(Object.keys(result)).not.toContain("token");
    expect(Object.keys(result)).not.toContain("tokenHash");
  });

  // A message saying "you have been invited" about a row that rolled back is a link
  // to nothing — so the send waits for the commit, and a failed commit sends nothing.
  it("sends no mail when the unit of work does not commit", async () => {
    const h = harness({ unitOfWork: new FailingUnitOfWork() });

    await expect(
      h.useCase.execute(actorHolding("member.invite", "member.read"), {
        email: "b@example.test",
        roleId: ROLE,
      }),
    ).rejects.toThrow("commit failed");

    expect(h.mailer.sent).toEqual([]);
  });

  // The other side of the same ordering: past the commit there is a live invitation, so
  // a transport failure is not a reason to answer 5xx over it. The adapter records why.
  it("returns the invitation when the mail cannot be sent", async () => {
    const h = harness();
    h.mailer.failing = true;

    const result = await h.useCase.execute(actorHolding("member.invite", "member.read"), {
      email: "b@example.test",
      roleId: ROLE,
    });

    expect(result.email).toBe("b@example.test");
    expect(h.invitations.saved).toHaveLength(1);
    expect(h.activity.records).toHaveLength(1);
  });
});

// `R.37`. Assigned as a membership a goal role would hand its keys out across the whole
// tenant rather than inside one goal, and no key ships goal-scoped to catch it.
describe("InviteMemberUseCase — the role's scope", () => {
  it("refuses an invitation onto a goal-scoped role", async () => {
    const h = harness();

    await expect(
      h.useCase.execute(actorHolding("member.invite"), {
        email: "b@example.test",
        roleId: GOAL_ROLE,
      }),
    ).rejects.toThrow("CONFLICT");
  });
});
