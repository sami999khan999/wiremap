import { ACTIVITY_ACTIONS } from "../catalog/index.js";

// The key union. `ActivityLogger.record` takes this rather than `string`, so a
// twenty-second action cannot be written without an entry beside the other twenty-one.
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;

export interface ActivityActionMeta {
  readonly action: ActivityAction;
  readonly label: string;
}

// Built once and frozen: a derived lookup rebuilt per call is a per-call allocation on
// a path the reconcile pass takes for every row.
const ALL: readonly ActivityActionMeta[] = Object.freeze(
  (Object.keys(ACTIVITY_ACTIONS) as ActivityAction[]).map((action) => ({
    action,
    label: ACTIVITY_ACTIONS[action].label,
  })),
);

export class ActivityActions {
  private constructor() {}

  public static all(): readonly ActivityActionMeta[] {
    return ALL;
  }

  // `Object.hasOwn`, not a bare index, for `ProcedurePermissions`' reason: an
  // unguarded lookup of `"toString"` resolves up the prototype chain to a function.
  public static isKnown(action: string): action is ActivityAction {
    return Object.hasOwn(ACTIVITY_ACTIONS, action);
  }
}
