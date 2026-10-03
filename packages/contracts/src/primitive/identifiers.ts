import { z } from "../import.js";

// Branded, so `reactivateTask(goalId, taskId)` with the arguments swapped is a
// compile error rather than a query that returns nothing.
export class Identifiers {
  private constructor() {}

  // The tenant key, on every domain table. The one identifier where a swapped
  // argument is a cross-tenant leak rather than an empty result set.
  public static readonly organizationId = z.uuid().brand<"OrganizationId">();
  public static readonly userId = z.uuid().brand<"UserId">();
  public static readonly roleId = z.uuid().brand<"RoleId">();
  public static readonly goalId = z.uuid().brand<"GoalId">();
  public static readonly taskId = z.uuid().brand<"TaskId">();
  public static readonly apiKeyId = z.uuid().brand<"ApiKeyId">();
  public static readonly invitationId = z.uuid().brand<"InvitationId">();
  public static readonly notificationId = z.uuid().brand<"NotificationId">();
  public static readonly docSpaceId = z.uuid().brand<"DocSpaceId">();
  public static readonly docPageId = z.uuid().brand<"DocPageId">();
  public static readonly teamId = z.uuid().brand<"TeamId">();
  public static readonly invitationLinkId = z.uuid().brand<"InvitationLinkId">();
  public static readonly domainId = z.uuid().brand<"DomainId">();
  // A project is the kit's goal: its id is the `goalId` a goal-scoped key is checked against.
  public static readonly projectId = z.uuid().brand<"ProjectId">();
  public static readonly repositoryId = z.uuid().brand<"RepositoryId">();
  public static readonly projectGrantId = z.uuid().brand<"ProjectGrantId">();
  public static readonly scanId = z.uuid().brand<"ScanId">();
  public static readonly graphViewId = z.uuid().brand<"GraphViewId">();
}

export type OrganizationId = z.infer<typeof Identifiers.organizationId>;
export type UserId = z.infer<typeof Identifiers.userId>;
export type RoleId = z.infer<typeof Identifiers.roleId>;
export type GoalId = z.infer<typeof Identifiers.goalId>;
export type TaskId = z.infer<typeof Identifiers.taskId>;
export type ApiKeyId = z.infer<typeof Identifiers.apiKeyId>;
export type InvitationId = z.infer<typeof Identifiers.invitationId>;
export type NotificationId = z.infer<typeof Identifiers.notificationId>;
export type DocSpaceId = z.infer<typeof Identifiers.docSpaceId>;
export type DocPageId = z.infer<typeof Identifiers.docPageId>;
export type TeamId = z.infer<typeof Identifiers.teamId>;
export type InvitationLinkId = z.infer<typeof Identifiers.invitationLinkId>;
export type DomainId = z.infer<typeof Identifiers.domainId>;
export type ProjectId = z.infer<typeof Identifiers.projectId>;
export type RepositoryId = z.infer<typeof Identifiers.repositoryId>;
export type ProjectGrantId = z.infer<typeof Identifiers.projectGrantId>;
export type ScanId = z.infer<typeof Identifiers.scanId>;
export type GraphViewId = z.infer<typeof Identifiers.graphViewId>;
