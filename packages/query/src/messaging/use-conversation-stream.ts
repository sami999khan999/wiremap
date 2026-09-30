import {
  type ApiClient,
  type RealtimeMessage,
  useEffect,
  useQueryClient,
  useRef,
  useState,
} from "../import.js";
import { QueryKeys } from "../key/index.js";
import { RealtimeRefetch, RealtimeStream } from "../realtime/index.js";
import { MessagingQueries } from "./messaging.queries.js";

// A signal is published at most every two seconds, so a little over that is how long one
// stays true before the person is taken to have stopped.
const TYPING_EXPIRY_MS = 4_000;
const SWEEP_MS = 1_000;
// Enough to span the gap between a send's fast-path frame and its durable one.
const SEEN_LIMIT = 256;

// The newest page at most once a second, as `RealtimeRefetch` does for the rest. Without the
// floor a burst arriving a little slower than a fetch cost one fetch per message (`CP1.9`).
const REFRESH_INTERVAL_MS = 1_000;

export interface ConversationStreamState {
  readonly connected: boolean;
  // Keyed by user with an expiry, not a boolean: two people typing and one stopping has
  // to clear one name, and a boolean cannot say which.
  readonly typing: readonly string[];
}

// The **second** stream, and the only one with an input. Opened while a conversation is
// on screen and closed when it leaves, which is what keeps a tab to two connections.
export function useConversationStream(
  client: ApiClient,
  conversationId: string,
  // The reader's own id, so their own keystrokes do not render as somebody typing at
  // them. Filtered here rather than at the publisher: the frame is legitimately
  // ──
  // addressed to the whole channel, and every other member does want it.
  selfId?: string,
): ConversationStreamState {
  const queryClient = useQueryClient();
  const cache = useRef(queryClient);
  cache.current = queryClient;

  // A ref for the same reason `cache` is one: naming it as a dependency would tear the
  // stream down and reopen it the moment the session resolves, on every page load.
  const self = useRef(selfId);
  self.current = selfId;

  const [connected, setConnected] = useState(false);
  const [typing, setTyping] = useState<ReadonlyMap<string, number>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const controller = new AbortController();
    const refetch = new RealtimeRefetch(cache.current);
    const listKey = QueryKeys.message.list(conversationId);
    // Every send arrives twice, once from the request and once from the outbox.
    const seen = new Set<string>();
    let refreshing: Promise<void> | null = null;
    let refreshAgain = false;

    // Single-flight with one trailing run, like `RealtimeRefetch`, but for one page.
    const refreshNewest = () => {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      const startedAt = Date.now();
      refreshing = MessagingQueries.refreshNewest(cache.current, client, conversationId)
        .catch(() => refetch.request(listKey))
        // Held busy for the rest of the second, so frames in it fold into one trailing run.
        .then(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, Math.max(0, REFRESH_INTERVAL_MS - (Date.now() - startedAt)));
            }),
        )
        .finally(() => {
          refreshing = null;
          if (refreshAgain && !controller.signal.aborted) {
            refreshAgain = false;
            refreshNewest();
          }
        });
    };

    const onFrame = (frame: RealtimeMessage) => {
      if (frame.kind === "typing") {
        if (frame.userId === self.current) return;
        const expiresAt = Date.now() + TYPING_EXPIRY_MS;
        setTyping((current) => new Map(current).set(frame.userId, expiresAt));
        return;
      }

      if (frame.kind === "event" && frame.payload.messageId) {
        const key = `${frame.name}:${frame.payload.messageId}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
      }

      // Refetched, never patched from the payload. A send touches only the newest page;
      // an edit, a delete or a resync can touch any loaded one.
      if (frame.kind === "event" && frame.name === "message.sent") refreshNewest();
      else refetch.request(listKey);
    };

    void RealtimeStream.run<RealtimeMessage>({
      open: (signal, lastEventId) =>
        client.realtime.conversation({ conversationId }, { signal, lastEventId }),
      onConnected: (value) => {
        if (!controller.signal.aborted) setConnected(value);
      },
      onFrame,
      signal: controller.signal,
    });

    return () => {
      setConnected(false);
      setTyping(new Map());
      refetch.dispose();
      controller.abort();
    };
  }, [client, conversationId]);

  // Swept on a timer rather than per frame: nothing publishes a "stopped typing", so
  // expiry is the only thing that clears a name.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => {
        const live = [...current].filter(([, expiresAt]) => expiresAt > now);
        return live.length === current.size ? current : new Map(live);
      });
    }, SWEEP_MS);

    return () => clearInterval(timer);
  }, []);

  return { connected, typing: [...typing.keys()] };
}
