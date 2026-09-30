import type {
  ApiClient,
  ListNotificationsInput,
  MarkNotificationReadInput,
  UpdateNotificationPreferenceInput,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

// Derived, never restated: the envelope is inferred per procedure, and a local interface
// that drifted from it would be written back into the cache by `setQueryData`.
type Page = Awaited<ReturnType<ApiClient["notification"]["list"]>>;
type Pages = { readonly pages: readonly Page[]; readonly pageParams: readonly unknown[] };
type Count = Awaited<ReturnType<ApiClient["notification"]["unreadCount"]>>;

export class NotificationMutations {
  private constructor() {}

  // Optimistic on the list the row is on, because marking read is the one interaction
  // here that has to feel instant — it happens on click, on a row already on screen.
  public static useMarkRead(client: ApiClient, params: Omit<ListNotificationsInput, "cursor">) {
    return useAppMutation<{ ok: true }, MarkNotificationReadInput, Pages>({
      mutationFn: (input) => client.notification.markRead(input),
      // The count too: the badge is a separate key, and a row cleared without it goes
      // grey while the bell still claims one.
      invalidates: [QueryKeys.notification.all()],
      optimistic: {
        queryKey: QueryKeys.notification.list(params),
        apply: (cached, { id }) => ({
          ...cached,
          pages: cached.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, readAt: new Date() } : item,
            ),
          })),
        }),
      },
    });
  }

  // Optimistic on the count rather than the list: "clear everything" is judged by the
  // badge going to zero, and the list refetches behind it.
  public static useMarkAllRead(client: ApiClient) {
    return useAppMutation<{ ok: true }, void, Count>({
      mutationFn: () => client.notification.markAllRead(),
      invalidates: [QueryKeys.notification.all()],
      optimistic: {
        queryKey: QueryKeys.notification.unreadCount(),
        apply: () => ({ count: 0 }),
      },
    });
  }

  // Not optimistic. A preference is a form control the person is looking at, and a
  // rollback on failure would flip the select back under their cursor.
  public static useUpdatePreference(client: ApiClient) {
    return useAppMutation<{ ok: true }, UpdateNotificationPreferenceInput>({
      mutationFn: (input) => client.notification.updatePreference(input),
      invalidates: [QueryKeys.notification.preferences()],
    });
  }
}
