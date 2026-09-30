import type { QueryClient } from "~/import.js";
import type { SessionStore } from "~/store/session.store.js";

// What every route does after the session underneath it changes. The leading hyphen keeps
// this file out of the route tree, as `-guard.ts` and `-redirect.ts` do.
export interface SessionRefresh {
  readonly queryClient: QueryClient;
  readonly session: SessionStore;
  // `router.invalidate()`. Passed rather than imported: the hook is only callable from a
  // component, and this file is not one.
  readonly invalidateRouter: () => Promise<void>;
  readonly go: () => void;
}

// Clear the cache, invalidate the session store, re-run the root loader, then navigate —
// in that order. Four call sites wrote it; see query/docs/reference/mutations.md.

// The order is the point: reversed, one frame renders the previous tenant's rows under
// the new tenant's session.
export function refreshSession({
  queryClient,
  session,
  invalidateRouter,
  go,
}: SessionRefresh): void {
  queryClient.clear();
  session.invalidate();
  void invalidateRouter().then(go);
}

// Sign-in is the one that must *not* clear: nothing in the cache belongs to a previous
// session, and clearing it throws away the messages the shell just loaded.
export function completeSignIn(
  session: SessionStore,
  invalidateRouter: () => Promise<void>,
  go: () => void,
): void {
  session.invalidate();
  void invalidateRouter().then(go);
}
