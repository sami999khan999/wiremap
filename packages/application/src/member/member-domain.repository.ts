import type { DomainId, OrganizationId, PaginationQuery, RoleId, UserId } from "../import.js";

export interface MemberDomainRecord {
  readonly id: DomainId;
  readonly domain: string;
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

export interface MemberDomainPage {
  readonly items: readonly MemberDomainRecord[];
  readonly total: number;
}

export abstract class MemberDomainRepository {
  public abstract list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<MemberDomainPage>;

  public abstract findById(
    organizationId: OrganizationId,
    id: DomainId,
  ): Promise<MemberDomainRecord | null>;

  // Across every tenant, by design: a domain belongs to one organization, and the
  // question is which one. See docs/opinions/vocabulary.md on the exempt indexes.
  public abstract isClaimed(domain: string): Promise<boolean>;

  // The caller's address, only when verified: a domain is claimed by someone who has
  // proved they receive mail there.
  public abstract verifiedEmailOf(userId: UserId): Promise<string | null>;

  public abstract save(
    organizationId: OrganizationId,
    domain: {
      readonly id: DomainId;
      readonly domain: string;
      readonly roleId: RoleId;
      readonly createdBy: UserId;
    },
  ): Promise<void>;

  public abstract delete(organizationId: OrganizationId, id: DomainId): Promise<void>;
}
