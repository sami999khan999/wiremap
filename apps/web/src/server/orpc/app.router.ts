import { RealtimeRouter } from "../import.js";
import { ActivityRouter } from "./activity.router.js";
import { ApiKeyRouter } from "./api-key.router.js";
import { AskRouter } from "./ask.router.js";
import { CommentRouter } from "./comment.router.js";
import { DocGrantRouter } from "./doc-grant.router.js";
import { DocPageRouter } from "./doc-page.router.js";
import { DocSpaceRouter } from "./doc-space.router.js";
import { DocumentRouter } from "./document.router.js";
import { GithubRouter } from "./github.router.js";
import { MemberRouter } from "./member.router.js";
import { NotificationRouter } from "./notification.router.js";
import { OrganizationRouter } from "./organization.router.js";
import { OverrideRouter } from "./override.router.js";
import { PlatformRouter } from "./platform.router.js";
import { ProjectRouter } from "./project.router.js";
import { RoleRouter } from "./role.router.js";
import { ScanRouter } from "./scan.router.js";
import { TeamRouter } from "./team.router.js";
import { ViewRouter } from "./view.router.js";

// The merge point, mirroring `contract` from `@loadbearing/contracts` exactly — a
// mismatch is a type error. One line per slice: `task: TaskRouter.all`.
export const appRouter = {
  role: RoleRouter.all,
  member: MemberRouter.all,
  apiKey: ApiKeyRouter.all,
  document: DocumentRouter.all,
  notification: NotificationRouter.all,
  realtime: RealtimeRouter.all,
  platform: PlatformRouter.all,
  override: OverrideRouter.all,
  docSpace: DocSpaceRouter.all,
  docPage: DocPageRouter.all,
  docGrant: DocGrantRouter.all,
  organization: OrganizationRouter.all,
  team: TeamRouter.all,
  activity: ActivityRouter.all,
  project: ProjectRouter.all,
  github: GithubRouter.all,
  scan: ScanRouter.all,
  view: ViewRouter.all,
  comment: CommentRouter.all,
  ask: AskRouter.all,
};
