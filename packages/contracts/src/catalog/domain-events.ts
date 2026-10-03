import { activityEvents } from "./activity.events.js";
import { commentEvents } from "./comment.events.js";
import { memberEvents } from "./member.events.js";
import { scanEvents } from "./scan.events.js";

// Merged from team-owned fragments, one per slice. Not `EVENT_CATALOG` — that name is
// observability's, and the two are different vocabularies. See docs/index.md.
export const DOMAIN_EVENTS = {
  ...activityEvents,
  ...commentEvents,
  ...memberEvents,
  ...scanEvents,
} as const;
