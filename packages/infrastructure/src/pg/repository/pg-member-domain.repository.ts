import {
  and,
  asc,
  type DomainId,
  eq,
  type MemberDomainPage,
  type MemberDomainRecord,
  type MemberDomainRepository,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  type RoleId,
  sql,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { organizationDomains, roles, users } from "../schema/index.js";

export class PgMemberDomainRepository extends BaseRepository implements MemberDomainRepository {
  // `organization_domains` and `users`, both catalog.
  protected override readonly placement: Placement = "catalog";

  public async list(
    organizationId: OrganizationId,
    page: PaginationQuery,
  ): Promise<MemberDomainPage> {
    const scoped = eq(organizationDomains.organizationId, organizationId);
    const rows = await this.select()
      .where(scoped)
      .orderBy(asc(organizationDomains.domain))
      .limit(page.limit)
      .offset(page.offset);
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizationDomains)
      .where(scoped);
    return {
      items: rows.map((row) => PgMemberDomainRepository.toRecord(row)),
      total: counted?.total ?? 0,
    };
  }

  public async findById(
    organizationId: OrganizationId,
    id: DomainId,
  ): Promise<MemberDomainRecord | null> {
    const [row] = await this.select()
      .where(
        and(eq(organizationDomains.organizationId, organizationId), eq(organizationDomains.id, id)),
      )
      .limit(1);
    return row ? PgMemberDomainRepository.toRecord(row) : null;
  }

  // Unscoped on purpose, on `organization_domains_domain_uq`: the question is whether any
  // organization holds it.
  public async isClaimed(domain: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: organizationDomains.id })
      .from(organizationDomains)
      .where(eq(organizationDomains.domain, domain))
      .limit(1);
    return Boolean(row);
  }

  public async verifiedEmailOf(userId: UserId): Promise<string | null> {
    const [row] = await this.db
      .select({ email: users.email, verified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.verified ? row.email : null;
  }

  public async save(
    organizationId: OrganizationId,
    domain: { id: DomainId; domain: string; roleId: RoleId; createdBy: UserId },
  ): Promise<void> {
    await this.db.insert(organizationDomains).values({ ...domain, organizationId });
  }

  public async delete(organizationId: OrganizationId, id: DomainId): Promise<void> {
    await this.db
      .delete(organizationDomains)
      .where(
        and(eq(organizationDomains.organizationId, organizationId), eq(organizationDomains.id, id)),
      );
  }

  private select() {
    return this.db
      .select({
        id: organizationDomains.id,
        domain: organizationDomains.domain,
        roleId: organizationDomains.roleId,
        roleName: roles.name,
        createdBy: organizationDomains.createdBy,
        createdAt: organizationDomains.createdAt,
      })
      .from(organizationDomains)
      .innerJoin(roles, eq(roles.id, organizationDomains.roleId));
  }

  private static toRecord(row: {
    id: string;
    domain: string;
    roleId: string;
    roleName: string;
    createdBy: string;
    createdAt: Date;
  }): MemberDomainRecord {
    return {
      ...row,
      id: row.id as DomainId,
      roleId: row.roleId as RoleId,
      createdBy: row.createdBy as UserId,
    };
  }
}
