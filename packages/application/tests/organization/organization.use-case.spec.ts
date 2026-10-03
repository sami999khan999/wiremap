import { ConflictError, ForbiddenError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import type { MemberRecord, MemberRepository } from "../../src/member/member.repository.js";
import { RemoveOrganizationUseCase } from "../../src/organization/remove-organization.use-case.js";
import { TransferOwnershipUseCase } from "../../src/organization/transfer-ownership.use-case.js";
import type { TenantRepository } from "../../src/platform/tenant.repository.js";
import type { DomainEventPublisher, QueuePublisher } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import {
  ACTOR,
  ADMIN_ROLE,
  DirectUnitOfWork,
  holding,
  MEMBER_ROLE,
  ORG,
  OTHER,
  OWNER_ROLE,
  RecordingActivity,
  RecordingInvalidator,
  stubRoles,
} from "../support/wiremap-fakes.js";

const record = (userId: typeof ACTOR, roleKey: string, extra: Partial<MemberRecord> = {}) =>
  ({
    userId,
    name: roleKey,
    email: `${roleKey}@example.test`,
    roleId: roleKey === "owner" ? OWNER_ROLE : MEMBER_ROLE,
    roleKey,
    roleName: roleKey,
    joinedAt: new Date(),
    deactivated: false,
    suspended: false,
    exceptions: 0,
    ...extra,
  }) as MemberRecord;

function membersOf(rows: readonly MemberRecord[]) {
  const changes: { userId: string; roleId: string }[] = [];
  const repository = {
    findByUser: (_org: unknown, userId: string) =>
      Promise.resolve(rows.find((row) => row.userId === userId) ?? null),
    changeRole: (_org: unknown, userId: string, roleId: string) => {
      changes.push({ userId, roleId });
      return Promise.resolve();
    },
  } as unknown as MemberRepository;
  return { repository, changes };
}

const events = { publish: () => Promise.resolve() } as unknown as DomainEventPublisher;

const transfer = (rows: readonly MemberRecord[]) => {
  const members = membersOf(rows);
  const invalidator = new RecordingInvalidator();
  const useCase = new TransferOwnershipUseCase(
    new Authorizer(),
    members.repository,
    stubRoles(),
    invalidator,
    new RecordingActivity(),
    events,
    new DirectUnitOfWork(),
  );
  return { useCase, changes: members.changes, invalidator };
};

const OWNER = holding("organization.ownership.transfer", "member.read");

describe("TransferOwnershipUseCase", () => {
  it("promotes the target and steps the owner down to admin, together", async () => {
    const { useCase, changes, invalidator } = transfer([
      record(ACTOR, "owner"),
      record(OTHER, "member"),
    ]);

    await useCase.execute(OWNER, { userId: OTHER });

    expect(changes).toEqual([
      { userId: OTHER, roleId: OWNER_ROLE },
      { userId: ACTOR, roleId: ADMIN_ROLE },
    ]);
    expect(invalidator.users).toEqual([OTHER, ACTOR]);
  });

  it("refuses yourself, an inactive member, and a caller who is not the owner", async () => {
    await expect(
      transfer([record(ACTOR, "owner")]).useCase.execute(OWNER, { userId: ACTOR }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      transfer([
        record(ACTOR, "owner"),
        record(OTHER, "member", { deactivated: true }),
      ]).useCase.execute(OWNER, {
        userId: OTHER,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      transfer([record(ACTOR, "admin"), record(OTHER, "member")]).useCase.execute(OWNER, {
        userId: OTHER,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a principal without organization.ownership.transfer", async () => {
    await expect(
      transfer([record(ACTOR, "owner"), record(OTHER, "member")]).useCase.execute(
        holding("member.read"),
        {
          userId: OTHER,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("RemoveOrganizationUseCase", () => {
  const build = (isPlatform = false) => {
    const published: { queue: string; payload: unknown; name?: string }[] = [];
    const queue = {
      publish: (queueName: string, payload: unknown, options?: { name?: string }) => {
        published.push({ queue: queueName, payload, name: options?.name });
        return Promise.resolve();
      },
    } as unknown as QueuePublisher;
    const tenants = {
      findBy: () => Promise.resolve({ id: ORG, slug: "acme", name: "Acme", isPlatform }),
    } as unknown as TenantRepository;
    const useCase = new RemoveOrganizationUseCase(
      new Authorizer(),
      tenants,
      queue,
      new RecordingActivity(),
    );
    return { useCase, published };
  };

  it("queues the tenant delete when the slug is typed back", async () => {
    const { useCase, published } = build();

    await useCase.execute(holding("organization.delete"), { confirmSlug: "acme" });

    expect(published).toEqual([
      {
        queue: "maintenance",
        payload: { organizationId: ORG, actorId: ACTOR },
        name: "tenant-delete",
      },
    ]);
  });

  it("refuses a wrong slug, the platform tier, and a principal without the key", async () => {
    await expect(
      build().useCase.execute(holding("organization.delete"), { confirmSlug: "acm" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      build(true).useCase.execute(holding("organization.delete"), { confirmSlug: "acme" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      build().useCase.execute(holding("member.read"), { confirmSlug: "acme" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
