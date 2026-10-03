import { ActivityProcedures } from "../activity/index.js";
import { ApiKeyProcedures } from "../apikey/index.js";
import { AskProcedures } from "../ask/index.js";
import { CommentProcedures } from "../comment/index.js";
import { DocGrantProcedures, DocPageProcedures, DocSpaceProcedures } from "../doc/index.js";
import { DocumentProcedures } from "../document/index.js";
import { GithubProcedures } from "../github/index.js";
import { GraphProcedures } from "../graph/index.js";
import type { AnyContractRouter } from "../import.js";
import { MemberProcedures } from "../member/index.js";
import { NotificationProcedures } from "../notification/index.js";
import { OrganizationProcedures } from "../organization/index.js";
import { OverrideProcedures } from "../override/index.js";
import { PlatformProcedures } from "../platform/index.js";
import { ProjectProcedures } from "../project/index.js";
import { RealtimeProcedures } from "../realtime/index.js";
import { RoleProcedures } from "../role/index.js";
import { ScanProcedures } from "../scan/index.js";
import { TeamProcedures } from "../team/index.js";
import { ViewProcedures } from "../view/index.js";
import { WebhookProcedures } from "../webhook/index.js";

// The merge point for every slice's procedures, and registering one here binds three
// files to the same commit: its permissions, its procedure map, and its `apps/web` router.
export const contract = {
  role: RoleProcedures.all,
  member: MemberProcedures.all,
  apiKey: ApiKeyProcedures.all,
  document: DocumentProcedures.all,
  notification: NotificationProcedures.all,
  realtime: RealtimeProcedures.all,
  platform: PlatformProcedures.all,
  override: OverrideProcedures.all,
  docSpace: DocSpaceProcedures.all,
  docPage: DocPageProcedures.all,
  docGrant: DocGrantProcedures.all,
  organization: OrganizationProcedures.all,
  team: TeamProcedures.all,
  activity: ActivityProcedures.all,
  project: ProjectProcedures.all,
  scan: ScanProcedures.all,
  view: ViewProcedures.all,
  ask: AskProcedures.all,
  comment: CommentProcedures.all,
  graph: GraphProcedures.all,
  webhook: WebhookProcedures.all,
  github: GithubProcedures.all,
} as const satisfies AnyContractRouter;

export type AppContract = typeof contract;
