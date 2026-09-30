import type { ActivityAction } from "../import.js";
import type { Principal } from "../primitive/index.js";

// The audit trail. `action` is a key of `ACTIVITY_ACTIONS`, not a string: the
// projection policy has a row per action, and an unlisted one has no policy.
export abstract class ActivityLogger {
  // No `occurredAt` and no tenant: a caller that could pass its own timestamp is a
  // caller that can backdate an audit row.
  public abstract record(
    actor: Principal,
    action: ActivityAction,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}
