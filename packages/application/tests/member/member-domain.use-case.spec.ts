import { ConflictError, ForbiddenError, ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import { AddMemberDomainUseCase } from "../../src/member/add-member-domain.use-case.js";
import {
  type MemberDomainRecord,
  MemberDomainRepository,
} from "../../src/member/member-domain.repository.js";
import { MemberDomainRules } from "../../src/member/member-domain.rules.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import {
  DirectUnitOfWork,
  holding,
  MEMBER_ROLE,
  RecordingActivity,
  stubRoles,
  unlimited,
} from "../support/wiremap-fakes.js";

class MemoryDomains extends MemberDomainRepository {
  public readonly saved: MemberDomainRecord[] = [];
  public constructor(
    private readonly email: string | null,
    private readonly claimed: readonly string[] = [],
  ) {
    super();
  }
  public list() {
    return Promise.resolve({ items: this.saved, total: this.saved.length });
  }
  public findById(_org: unknown, id: string) {
    return Promise.resolve(this.saved.find((domain) => domain.id === id) ?? null);
  }
  public isClaimed(domain: string) {
    return Promise.resolve(this.claimed.includes(domain));
  }
  public verifiedEmailOf() {
    return Promise.resolve(this.email);
  }
  public save(_org: unknown, domain: Omit<MemberDomainRecord, "roleName" | "createdAt">) {
    this.saved.push({ ...domain, roleName: "member", createdAt: new Date() });
    return Promise.resolve();
  }
  public delete() {
    return Promise.resolve();
  }
}

const build = (domains: MemoryDomains) =>
  new AddMemberDomainUseCase(
    new Authorizer(),
    domains,
    stubRoles(),
    unlimited,
    new RecordingActivity(),
    new DirectUnitOfWork(),
  );

const ADMIN = holding("member.domain.manage", "member.read");

describe("AddMemberDomainUseCase", () => {
  it("claims the actor's own verified domain, lower-cased", async () => {
    const domains = new MemoryDomains("ada@Acme.Example");

    const saved = await build(domains).execute(ADMIN, {
      domain: "ACME.example",
      roleId: MEMBER_ROLE,
    });

    expect(saved.domain).toBe("acme.example");
  });

  it("refuses a public mail provider, a domain the actor is not at, and one already claimed", async () => {
    await expect(
      build(new MemoryDomains("ada@gmail.com")).execute(ADMIN, {
        domain: "gmail.com",
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      build(new MemoryDomains("ada@other.example")).execute(ADMIN, {
        domain: "acme.example",
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      build(new MemoryDomains(null)).execute(ADMIN, {
        domain: "acme.example",
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      build(new MemoryDomains("ada@acme.example", ["acme.example"])).execute(ADMIN, {
        domain: "acme.example",
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a principal without member.domain.manage", async () => {
    await expect(
      build(new MemoryDomains("ada@acme.example")).execute(holding("member.read"), {
        domain: "acme.example",
        roleId: MEMBER_ROLE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("MemberDomainRules", () => {
  it("takes the domain after the last @ and normalises it", () => {
    expect(MemberDomainRules.domainOf("a.b@Acme.Example.")).toBe("acme.example");
    expect(MemberDomainRules.domainOf("no-at-sign")).toBeNull();
    expect(MemberDomainRules.isPublic("GMAIL.com")).toBe(true);
  });
});
