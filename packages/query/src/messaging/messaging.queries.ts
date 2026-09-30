import type { ApiClient, InfiniteData, ListConversationsInput, QueryClient } from "../import.js";
import { infiniteQueryOptions, queryOptions } from "../import.js";
import { QueryKeys } from "../key/index.js";

type ConversationPage = Awaited<ReturnType<ApiClient["conversation"]["list"]>>;
type MessagePage = Awaited<ReturnType<ApiClient["message"]["list"]>>;
type MessagePages = InfiniteData<MessagePage, string | undefined>;
type MessageItem = MessagePage["items"][number];

export class MessagingQueries {
  private constructor() {}

  public static conversations(client: ApiClient, params: Omit<ListConversationsInput, "cursor">) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.conversation.list(params),
      queryFn: ({ pageParam, signal }) =>
        client.conversation.list(
          { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
          { signal },
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: ConversationPage) => last.nextCursor ?? undefined,
      staleTime: 30_000,
    });
  }

  public static conversation(client: ApiClient, conversationId: string) {
    return queryOptions({
      queryKey: QueryKeys.conversation.get(conversationId),
      queryFn: ({ signal }) => client.conversation.get({ conversationId }, { signal }),
      staleTime: 30_000,
    });
  }

  // Backwards from the newest, so the page param is named for the direction it goes.
  // `olderCursor` null is the start of the conversation, not an empty page.
  public static messages(client: ApiClient, conversationId: string) {
    return infiniteQueryOptions({
      queryKey: QueryKeys.message.list(conversationId),
      queryFn: ({ pageParam, signal }) =>
        client.message.list(
          { conversationId, ...(pageParam ? { before: pageParam } : {}) },
          { signal },
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: MessagePage) => last.olderCursor ?? undefined,
      // Zero, because the stream is what keeps this fresh. A stale time here would let a
      // remount show a conversation that is behind the one the tab was just watching.
      staleTime: 0,
    });
  }

  // One page, not every loaded one: a new message only lands on the newest, and refetching
  // them all cost a request per page per member per message.
  public static async refreshNewest(
    queryClient: QueryClient,
    client: ApiClient,
    conversationId: string,
  ): Promise<void> {
    const queryKey = QueryKeys.message.list(conversationId);
    if (!queryClient.getQueryData<MessagePages>(queryKey)?.pages.length) return;

    const fresh = await client.message.list({ conversationId });
    queryClient.setQueryData<MessagePages>(queryKey, (cached) =>
      cached ? MessagingQueries.splice(cached, fresh) : cached,
    );
  }

  // Fresh rows replace their cached copies, and an optimistic row by its `clientId`. No
  // overlap means more than a page arrived, so the gap cannot be stitched: start again.
  public static splice(cached: MessagePages, fresh: MessagePage): MessagePages {
    const [newest, ...older] = cached.pages;
    const ids = new Set(fresh.items.flatMap((item) => [item.id, item.clientId]));
    const overlaps = newest?.items.some((item) => ids.has(item.id)) ?? false;

    if (!newest || !overlaps) return { pages: [fresh], pageParams: [undefined] };

    const items = [...fresh.items, ...newest.items.filter((item) => !ids.has(item.id))].sort(
      (a, b) => MessagingQueries.newestFirst(a, b),
    );

    return { pages: [{ ...newest, items }, ...older], pageParams: cached.pageParams };
  }

  private static newestFirst(a: MessageItem, b: MessageItem): number {
    const byTime = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  }
}
