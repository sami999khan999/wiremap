import type { OrganizationId, PaginationQuery, TeamId, UserId } from "../import.js";

export interface TeamRecord {
  readonly id: TeamId;
  readonly name: string;
  readonly description: string | null;
  readonly memberCount: number;
  readonly createdAt: Date;
}

export interface TeamMemberRecord {
  readonly userId: UserId;
  readonly name: string;
  readonly email: string;
}

export interface TeamPage {
  readonly items: readonly TeamRecord[];
  readonly total: number;
}

export abstract class TeamRepository {
  public abstract list(organizationId: OrganizationId, page: PaginationQuery): Promise<TeamPage>;

  public abstract findById(organizationId: OrganizationId, id: TeamId): Promise<TeamRecord | null>;

  // Case-insensitive, so "Backend" and "backend" are one team. `exceptId` lets a rename
  // keep its own name.
  public abstract existsByName(
    organizationId: OrganizationId,
    name: string,
    exceptId?: TeamId,
  ): Promise<boolean>;

  public abstract members(
    organizationId: OrganizationId,
    id: TeamId,
  ): Promise<readonly TeamMemberRecord[]>;

  public abstract save(
    organizationId: OrganizationId,
    team: { readonly id: TeamId; readonly name: string; readonly description: string | null },
  ): Promise<void>;

  // Takes its memberships and its project grants with it.
  public abstract delete(organizationId: OrganizationId, id: TeamId): Promise<void>;

  // Idempotent both ways: adding a member twice or removing an absent one changes nothing.
  public abstract addMember(
    organizationId: OrganizationId,
    id: TeamId,
    userId: UserId,
  ): Promise<void>;

  public abstract removeMember(
    organizationId: OrganizationId,
    id: TeamId,
    userId: UserId,
  ): Promise<void>;
}
