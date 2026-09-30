import type { ApiClient, ArchivedNotificationQuery, ListNotificationsInput } from "../import.js";
import { infiniteQueryOptions, queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

type Page = Awaited<ReturnType<ApiClient["notification"]["list"]>>;

export class NotificationQueries {
  private constructor() {}

  // The same shape as `list`, over a different source. Five minutes, not thirty
  // seconds: an archived month does not change, and each page turn reads an object.
  public static archived(client: ApiClient, params: Omit<ArchivedNotificationQuery, "cursor">) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.notification.archived(params),
      queryFn: ({ pageParam }) =>
        client.notification.archived({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: Page) => last.nextCursor ?? undefined,
      staleTime: 300_000,
    });
  }

  // The months that exist, so the screen offers real ones rather than a date picker
  // that mostly returns nothing.
  public static archivedMonths(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.notification.archivedMonths(),
      queryFn: () => client.notification.archivedMonths(),
      staleTime: 300_000,
    });
  }

  // Infinite rather than paged: the inbox is a scroll, and the cursor lives in the page
  // data so the query key stays the same for every page of one filter.
  public static list(client: ApiClient, params: Omit<ListNotificationsInput, "cursor">) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.notification.list(params),
      queryFn: ({ pageParam }) =>
        client.notification.list({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
      initialPageParam: undefined as string | undefined,
      // Null is the last page, and it is not `items.length < limit`: a full page can
      // still be the last one.
      getNextPageParam: (last: Page) => last.nextCursor ?? undefined,
      staleTime: 30_000,
    });
  }

  // No `refetchOnWindowFocus`: the stream invalidates this key the moment a row is
  // written, so refetching on every tab switch is a request that changes nothing.
  public static unreadCount(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.notification.unreadCount(),
      queryFn: () => client.notification.unreadCount(),
      staleTime: 30_000,
    });
  }

  // Rarely changes and only by this person's own hand, so the only thing that
  // invalidates it is their own mutation.
  public static preferences(client: ApiClient) {
    return queryOptions({
      queryKey: QueryKeys.notification.preferences(),
      queryFn: () => client.notification.preferences({}),
      staleTime: 300_000,
    });
  }
}
