import { Endpoint } from "./endpoint.js";
import {
  ApiClient,
  CookieAuthStrategy,
  createIsomorphicFn,
  createQueryClient,
  createRouter as createTanStackRouter,
  type DehydratedState,
  dehydrate,
  hydrate,
  Locales,
  type MessageSnapshot,
  MessageStore,
  StaticContentSource,
} from "./import.js";
import { routeTree } from "./route-tree.gen.js";
import { serverTransport } from "./server/rpc-transport.js";
import { type AppearanceSnapshot, AppearanceStore } from "./store/appearance.store.js";
import { ArticleHtmlStore } from "./store/article-html.store.js";
import { type SessionSnapshot, SessionStore } from "./store/session.store.js";

export interface RouterDehydrated {
  readonly messages: MessageSnapshot;
  // Resolved once on the server and complete before the first client render: without it
  // the root's `beforeLoad` re-fetches during hydration and gated elements flash.
  readonly session: SessionSnapshot;
  // Rides the payload like the other two: without it the client re-reads the cookie
  // during hydration and the picker flashes its default.
  readonly appearance: AppearanceSnapshot;
  // Every loader's `ensureQueryData`, which the server has already paid for. Without it
  // the browser refetches all of it on mount and SSR bought nothing but the first paint.
  readonly queries: DehydratedState;
}

// The server branch and its imports are removed from the client build, which is what
// keeps the container graph out of the browser. See docs/reference/import-surfaces.md.
const transport = createIsomorphicFn()
  .client(() => ApiClient.overHttp(Endpoint.rpc, new CookieAuthStrategy(), Endpoint.realtime))
  .server(() => serverTransport());

// Called per request on the server and once in the browser, which is the lifetime every
// object below wants. A module-scope one would be a cross-tenant leak.
export function getRouter() {
  // The client catalog, never the server one: `email` is server-only.
  const content = new StaticContentSource();
  // Seeded with the default; `__root.tsx`'s `beforeLoad` calls `setLocale` once the
  // cookie and `Accept-Language` have been read, before any namespace is fetched.
  const messages = new MessageStore(content, MessageStore.empty(Locales.DEFAULT));
  const session = new SessionStore();
  const appearance = new AppearanceStore();
  const { queryClient, apiClient } = createQueryClient({ transport: transport() });

  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    // Load-bearing: without it the first navigation into an unseen namespace resolves
    // its dynamic import *during* the loader, which is a visible pause.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Seeded signed-out: a guard that somehow ran before `__root.tsx` resolved sees
    // `empty()`, which denies.
    context: {
      messages,
      content,
      queryClient,
      api: apiClient,
      session,
      appearance,
      // Seeded signed-out: an empty capability set denies everything, and there is no
      // loading state that grants access.
      user: session.user,
      capabilities: session.dto,
      googleEnabled: session.googleEnabled,
      appearanceSnapshot: appearance.current,
    },
    // After every matched loader has resolved, so the snapshot is the union of the shell
    // and the entry path — and the first client render sees a complete `Translator`.
    dehydrate: (): RouterDehydrated => ({
      messages: messages.dehydrate(),
      session: session.dehydrate(),
      appearance: appearance.dehydrate(),
      // Less each doc page's HTML, which the markup already carries: see article-html.store.
      queries: ArticleHtmlStore.strip(dehydrate(queryClient)),
    }),
    hydrate: (payload: RouterDehydrated) => {
      messages.restore(payload.messages);
      session.restore(payload.session);
      appearance.restore(payload.appearance);
      // Before the first render, so a mounted `useQuery` reads cache rather than opening
      // a request. `staleTime` is 30 s, which is what stops it refetching anyway.
      hydrate(queryClient, payload.queries);
    },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }

  // The serializer validates `dehydrate`'s return structurally and refuses a type it
  // does not know. This is global, which is the one judgement in the change: nothing
  // ──
  // else may then declare `DehydratedState` as something the wire cannot carry.
  interface SerializableExtensions {
    DehydratedState: DehydratedState;
  }
}
