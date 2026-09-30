import type { ApiClient } from "../import.js";
import { queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

export class WidgetQueries {
  private constructor() {}

  // Five minutes: a hide is this person's own click, which invalidates it; nobody else's
  // action changes it but an admin's default, and a card reappearing late is harmless.
  public static preferences(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.widget.preferences(),
      queryFn: () => client.widget.preferences({}),
      staleTime: 300_000,
    });
  }

  // Another member's, for the inspector. Always fresh: it is read to answer a question
  // someone is asking right now, not rendered on every page.
  public static preferencesOf(client: ApiClient, userId: string) {
    return queryOptions({
      queryKey: QueryKeys.widget.preferencesOf(userId),
      queryFn: () => client.widget.preferencesOf({ userId }),
      staleTime: 0,
    });
  }
}
