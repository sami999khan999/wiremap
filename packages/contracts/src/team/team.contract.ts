import { z } from "../import.js";
import { Identifiers, Pagination } from "../primitive/index.js";

export class TeamContract {
  private constructor() {}

  // A named group of members. A team grants nothing on its own; a project that names it
  // grants its members that project's role.
  public static readonly entity = z.object({
    id: Identifiers.teamId,
    name: z.string().min(1),
    description: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    createdAt: z.date(),
  });

  public static readonly member = z.object({
    userId: Identifiers.userId,
    name: z.string(),
    email: z.string(),
  });

  public static readonly create = z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(280).nullable(),
  });

  public static readonly update = z.object({
    teamId: Identifiers.teamId,
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(280).nullable(),
  });

  public static readonly ref = z.object({
    teamId: Identifiers.teamId,
  });

  public static readonly membership = z.object({
    teamId: Identifiers.teamId,
    userId: Identifiers.userId,
  });

  public static readonly listQuery = Pagination.query;
}

export type TeamDto = z.infer<typeof TeamContract.entity>;
export type TeamMemberDto = z.infer<typeof TeamContract.member>;
export type CreateTeamInput = z.infer<typeof TeamContract.create>;
export type UpdateTeamInput = z.infer<typeof TeamContract.update>;
export type TeamRefInput = z.infer<typeof TeamContract.ref>;
export type TeamMembershipInput = z.infer<typeof TeamContract.membership>;
