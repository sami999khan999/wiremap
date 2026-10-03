import {
  and,
  asc,
  eq,
  ne,
  type OrganizationId,
  type PaginationQuery,
  type Placement,
  sql,
  type TeamId,
  type TeamMemberRecord,
  type TeamPage,
  type TeamRecord,
  type TeamRepository,
  type UserId,
} from "../../import.js";
import { BaseRepository } from "../primitive/index.js";
import { teamMembers, teams, users } from "../schema/index.js";

// A team's size, counted in the same statement as the team: a per-row count is the N+1
// `PgMemberRepository` names.
const MEMBER_COUNT = sql<number>`(select count(*)::int from team_members tm
  where tm.organization_id = "teams"."organization_id" and tm.team_id = "teams"."id")`;

export class PgTeamRepository extends BaseRepository implements TeamRepository {
  protected override readonly placement: Placement = "catalog";

  public async list(organizationId: OrganizationId, page: PaginationQuery): Promise<TeamPage> {
    const scoped = eq(teams.organizationId, organizationId);
    const rows = await this.select()
      .where(scoped)
      .orderBy(asc(teams.name))
      .limit(page.limit)
      .offset(page.offset);
    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(teams)
      .where(scoped);
    return { items: rows.map((row) => PgTeamRepository.toRecord(row)), total: counted?.total ?? 0 };
  }

  public async findById(organizationId: OrganizationId, id: TeamId): Promise<TeamRecord | null> {
    const [row] = await this.select()
      .where(and(eq(teams.organizationId, organizationId), eq(teams.id, id)))
      .limit(1);
    return row ? PgTeamRepository.toRecord(row) : null;
  }

  public async existsByName(
    organizationId: OrganizationId,
    name: string,
    exceptId?: TeamId,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(
          eq(teams.organizationId, organizationId),
          sql`lower(${teams.name}) = lower(${name})`,
          exceptId ? ne(teams.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  public async members(
    organizationId: OrganizationId,
    id: TeamId,
  ): Promise<readonly TeamMemberRecord[]> {
    const rows = await this.db
      .select({ userId: teamMembers.userId, name: users.name, email: users.email })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.organizationId, organizationId), eq(teamMembers.teamId, id)))
      .orderBy(asc(users.name));
    return rows.map((row) => ({ ...row, userId: row.userId }));
  }

  // Upsert on the id: create and rename are one write, as `RoleRepository.save` is.
  public async save(
    organizationId: OrganizationId,
    team: { id: TeamId; name: string; description: string | null },
  ): Promise<void> {
    await this.db
      .insert(teams)
      .values({ ...team, organizationId })
      .onConflictDoUpdate({
        target: teams.id,
        set: { name: team.name, description: team.description, updatedAt: sql`now()` },
        setWhere: eq(teams.organizationId, organizationId),
      });
  }

  // `team_members` cascades on the team's id. A project grant naming the team goes with it
  // once projects exist, in the same transaction, by the same cascade.
  public async delete(organizationId: OrganizationId, id: TeamId): Promise<void> {
    await this.db
      .delete(teams)
      .where(and(eq(teams.organizationId, organizationId), eq(teams.id, id)));
  }

  public async addMember(
    organizationId: OrganizationId,
    id: TeamId,
    userId: UserId,
  ): Promise<void> {
    await this.db
      .insert(teamMembers)
      .values({ organizationId, teamId: id, userId })
      .onConflictDoNothing();
  }

  public async removeMember(
    organizationId: OrganizationId,
    id: TeamId,
    userId: UserId,
  ): Promise<void> {
    await this.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.organizationId, organizationId),
          eq(teamMembers.teamId, id),
          eq(teamMembers.userId, userId),
        ),
      );
  }

  private select() {
    return this.db
      .select({
        id: teams.id,
        name: teams.name,
        description: teams.description,
        memberCount: MEMBER_COUNT,
        createdAt: teams.createdAt,
      })
      .from(teams);
  }

  private static toRecord(row: {
    id: string;
    name: string;
    description: string | null;
    memberCount: number;
    createdAt: Date;
  }): TeamRecord {
    return { ...row, id: row.id as TeamId };
  }
}
