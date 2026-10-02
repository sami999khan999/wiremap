import {
  type ApiClient,
  createContext,
  type QueryKey,
  type ReactNode,
  type RealtimeMessage,
  useContext,
  useEffect,
  useMemo,
  useQueryClient,
  useRef,
  useState,
} from "../import.js";
import { RealtimeRefetch } from "./realtime-refetch.js";
import { RealtimeRoutes } from "./realtime-route.js";
import { RealtimeStream } from "./realtime-stream.js";

export interface RealtimeState {
  readonly connected: boolean;
}

const RealtimeContext = createContext<RealtimeState>({ connected: false });

type Listener = (message: RealtimeMessage) => void;
const listeners = new Set<Listener>();

export interface RealtimeProviderProps {
  readonly client: ApiClient;
  // The active tenant. The server builds the channel from the principal when the stream
  // opens, so a switch with no remount leaves the tab reading the tenant it left.
  readonly organizationId: string | null;
  // `stream` holds the kit's server stream open; `poll` refetches what a frame would
  // have named, on a timer and whenever the tab becomes visible. Wiremap polls.
  readonly transport?: "stream" | "poll";
  readonly pollIntervalMs?: number;
  readonly children: ReactNode;
}

// A bell a minute behind is fine; a tab in the background polls not at all.
const POLL_INTERVAL_MS = 60_000;

// One stream per tab, opened here rather than per component. On HTTP/1.1 a browser holds
// six connections to an origin, and each open stream is one of them.
export function RealtimeProvider({
  client,
  organizationId,
  transport = "stream",
  pollIntervalMs = POLL_INTERVAL_MS,
  children,
}: RealtimeProviderProps): ReactNode {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  // Read inside the effect rather than listed as a dependency: a new `QueryClient`
  // identity on a re-render would tear the stream down and open another.
  const cache = useRef(queryClient);
  cache.current = queryClient;

  useEffect(() => {
    // No `window` is SSR. Opening a stream there would hold a server-side request open
    // for the life of a render that has already finished.
    if (typeof window === "undefined") return;
    if (organizationId === null) return;

    const controller = new AbortController();
    const refetch = new RealtimeRefetch(cache.current);
    const request = (queryKey: QueryKey) => refetch.request(queryKey);

    if (transport === "poll") {
      const poll = (): void => {
        if (document.visibilityState === "visible") RealtimeRoutes.resync(request);
      };
      const timer = setInterval(poll, pollIntervalMs);
      document.addEventListener("visibilitychange", poll);
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", poll);
        refetch.dispose();
      };
    }

    void RealtimeStream.run<RealtimeMessage>({
      open: (signal, lastEventId) => client.realtime.stream(undefined, { signal, lastEventId }),
      onConnected: (value) => {
        if (!controller.signal.aborted) setConnected(value);
      },
      onFrame: (message) => {
        // A resync means frames were lost, so everything the table names is suspect.
        // Listeners get every frame either way.
        if (message.kind === "resync") RealtimeRoutes.resync(request);
        else if (message.kind === "event")
          RealtimeRoutes.apply(request, message.name, message.payload);

        for (const listener of listeners) listener(message);
      },
      signal: controller.signal,
    });

    return () => {
      setConnected(false);
      refetch.dispose();
      controller.abort();
    };
  }, [client, organizationId, transport, pollIntervalMs]);

  // Memoised, or every render hands each consumer a new object and re-renders all of them.
  const value = useMemo(() => ({ connected }), [connected]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}

export function subscribeToFrames(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
