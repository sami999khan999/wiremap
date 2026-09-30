import { AnalyticsProcedures } from "../analytics/index.js";
import { ApiKeyProcedures } from "../apikey/index.js";
import { DocGrantProcedures, DocPageProcedures, DocSpaceProcedures } from "../doc/index.js";
import { DocumentProcedures } from "../document/index.js";
import type { AnyContractRouter } from "../import.js";
import { MemberProcedures } from "../member/index.js";
import { ConversationProcedures, MessageProcedures } from "../messaging/index.js";
import { NotificationProcedures } from "../notification/index.js";
import { OverrideProcedures } from "../override/index.js";
import { PlatformProcedures } from "../platform/index.js";
import { RealtimeProcedures } from "../realtime/index.js";
import { RoleProcedures } from "../role/index.js";
import { WidgetProcedures } from "../widget/index.js";

// The merge point for every slice's procedures, and registering one here binds three
// files to the same commit: its permissions, its procedure map, and its `apps/web` router.
export const contract = {
  role: RoleProcedures.all,
  member: MemberProcedures.all,
  apiKey: ApiKeyProcedures.all,
  document: DocumentProcedures.all,
  notification: NotificationProcedures.all,
  conversation: ConversationProcedures.all,
  message: MessageProcedures.all,
  realtime: RealtimeProcedures.all,
  platform: PlatformProcedures.all,
  analytics: AnalyticsProcedures.all,
  override: OverrideProcedures.all,
  widget: WidgetProcedures.all,
  docSpace: DocSpaceProcedures.all,
  docPage: DocPageProcedures.all,
  docGrant: DocGrantProcedures.all,
} as const satisfies AnyContractRouter;

export type AppContract = typeof contract;
