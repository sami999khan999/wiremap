import { z } from "../import.js";

// `24.2a`: an audit row a catalog transaction wrote for a tenant that lives on another node.
// The outbox carries it there, so it is saved with the action and kept in one place.
export const activityEvents = {
  "activity.recorded": z.object({
    // The row's own id, so a redelivery lands on the row it already wrote.
    entryId: z.uuid(),
    action: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  }),
} as const;
