import type {
  ApiClient,
  CapabilitySetDto,
  ContentSource,
  MessageStore,
  QueryClient,
  SessionUser,
} from "~/import.js";
import type { AppearanceSnapshot, AppearanceStore } from "~/store/appearance.store.js";
import type { SessionStore } from "~/store/session.store.js";

// What every route sees. Built per request in `router.tsx`, never at module scope.
export interface RouterContext {
  readonly messages: MessageStore;
  // The seam, not `navItems`: the nav is content, and a CMS behind this port must not
  // mean editing the layout that renders it.
  readonly content: ContentSource;
  readonly queryClient: QueryClient;
  readonly api: ApiClient;
  // Here so the root's `beforeLoad` can ask whether the answer already rode in on the
  // SSR payload, and so a sign-in has something to invalidate.
  readonly session: SessionStore;
  // Same shape as `session`, same reason: resolved once on the server so the first
  // painted byte already carries the palette rather than correcting itself.
  readonly appearance: AppearanceStore;
  // The two fields `RouteGuard` reads, seeded signed-out. The DTO rather than a
  // `CapabilitySet`, because a dehydrated value may carry no method.
  readonly user: SessionUser | null;
  readonly capabilities: CapabilitySetDto;
  // Resolved server-side with the session, because `Env` is server-only and the sign-in
  // page decides before the first painted byte.
  readonly googleEnabled: boolean;
  // What `__root.tsx` writes onto <html>. A plain object, not the store: TanStack Router
  // dehydrates a `beforeLoad` return value and rejects anything carrying a method.
  readonly appearanceSnapshot: AppearanceSnapshot;
}
