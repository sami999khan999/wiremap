import type { ApiClient, WidgetPreferenceUpdateInput } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class WidgetMutations {
  private constructor() {}

  public static useUpdatePreference(client: ApiClient) {
    return useAppMutation<{ ok: true }, WidgetPreferenceUpdateInput>({
      mutationFn: (input) => client.widget.updatePreference(input),
      invalidates: [QueryKeys.widget.preferences()],
    });
  }

  // Every member's view changes, and this session's own preferences read the default too.
  public static useUpdateDefault(client: ApiClient) {
    return useAppMutation<{ ok: true }, WidgetPreferenceUpdateInput>({
      mutationFn: (input) => client.widget.updateDefault(input),
      invalidates: [QueryKeys.widget.all()],
    });
  }
}
