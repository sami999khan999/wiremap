import { createFileRoute } from "@tanstack/react-router";
import {
  Can,
  type ClientNamespace,
  CreateRoleForm,
  EffectivePermissionsInspector,
  RoleList,
  RoleMatrix,
  RoleQueries,
  useCapabilities,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

// One local const referenced twice, as in `/sign-in`: `staticData` is what a prefetcher
// or a coverage test can read without executing anything, and the loader resolves it.
const MESSAGES = ["role"] as const satisfies readonly ClientNamespace[];

// The same page and limit `RoleMatrix` asks for, so its `useAppQuery` reads the cache
// the loader filled rather than issuing a second request after hydration.
const PAGE = { limit: 25, offset: 0 } as const;

// Behind `rbac.role.read` — the same key the procedure is gated on and the use-case
// asserts. See docs/reference/enforcement-surfaces.md.
export const Route = createFileRoute("/(app)/_authenticated/settings/roles")({
  beforeLoad: RouteGuard.requirePermission("rbac.role.read"),
  staticData: { messages: MESSAGES },
  // Both, in parallel. `ensureQueryData` runs under Node during SSR, which is what
  // makes `router.tsx`'s in-process transport load-bearing rather than an optimisation.
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(RoleQueries.list(context.api, PAGE)),
      context.queryClient.ensureQueryData(RoleQueries.entitlement(context.api)),
    ]),
  component: Roles,
});

function Roles() {
  const { t } = useMessages("role");
  const capabilities = useCapabilities();

  return (
    <main>
      <h1>{t("role.title")}</h1>
      {
        // Names and lifecycle first: the matrix below is twenty rows tall, and a create
        // form under it is a form nobody finds.
      }
      <RoleList />
      <Can permission="rbac.role.manage" capabilities={capabilities}>
        <CreateRoleForm />
      </Can>
      {
        // Server state: the half a guard cannot fake, because the API answers FORBIDDEN
        // to the same key the guard checked.
      }
      <RoleMatrix />
      {
        // Client state: answered from the bundled catalog and the session's own
        // `CapabilitySet`. No query, no round trip.
      }
      <EffectivePermissionsInspector />
    </main>
  );
}
