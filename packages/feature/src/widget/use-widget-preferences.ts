import { useSession } from "../auth/index.js";
import { useApiClient, useAppQuery, type WidgetPreferencesDto, WidgetQueries } from "../import.js";

// The rollout's gate on the client. Off, no request is made and no row hides anything, so an
// org without the flag sees exactly the dashboard it had before the table existed.
export const DISMISSAL = "widget.dismissal";

export interface WidgetPreferenceState {
  // False only while the flag is on and the rows have not arrived. A zone renders no card
  // until then: one drawn early mounts, fetches, and vanishes if it turns out to be hidden.
  readonly ready: boolean;
  readonly preferences: WidgetPreferencesDto | undefined;
}

export function useWidgetPreferences(): WidgetPreferenceState {
  const { flags } = useSession();
  const client = useApiClient();
  const on = flags.has(DISMISSAL);
  const query = useAppQuery({ ...WidgetQueries.preferences(client), enabled: on });
  return on
    ? { ready: query.data !== undefined, preferences: query.data }
    : { ready: true, preferences: undefined };
}
