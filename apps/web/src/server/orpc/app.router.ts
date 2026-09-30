import { RealtimeRouter } from "../import.js";
import { AnalyticsRouter } from "./analytics.router.js";
import { ApiKeyRouter } from "./api-key.router.js";
import { DocGrantRouter } from "./doc-grant.router.js";
import { DocPageRouter } from "./doc-page.router.js";
import { DocSpaceRouter } from "./doc-space.router.js";
import { DocumentRouter } from "./document.router.js";
import { MemberRouter } from "./member.router.js";
import { MessageRouter } from "./message.router.js";
import { ConversationRouter } from "./messaging.router.js";
import { NotificationRouter } from "./notification.router.js";
import { OverrideRouter } from "./override.router.js";
import { PlatformRouter } from "./platform.router.js";
import { RoleRouter } from "./role.router.js";
import { WidgetRouter } from "./widget.router.js";

// The merge point, mirroring `contract` from `@loadbearing/contracts` exactly — a
// mismatch is a type error. One line per slice: `task: TaskRouter.all`.
export const appRouter = {
  role: RoleRouter.all,
  member: MemberRouter.all,
  apiKey: ApiKeyRouter.all,
  document: DocumentRouter.all,
  notification: NotificationRouter.all,
  realtime: RealtimeRouter.all,
  conversation: ConversationRouter.all,
  message: MessageRouter.all,
  platform: PlatformRouter.all,
  analytics: AnalyticsRouter.all,
  override: OverrideRouter.all,
  widget: WidgetRouter.all,
  docSpace: DocSpaceRouter.all,
  docPage: DocPageRouter.all,
  docGrant: DocGrantRouter.all,
};
