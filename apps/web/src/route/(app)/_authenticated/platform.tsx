import { createFileRoute, Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  OrganizationClient,
  OrganizationMutations,
  PlatformNav,
  useMemo,
} from "~/import.js";
import { refreshSession } from "~/route/-session.js";

const MESSAGES = ["platform"] as const satisfies readonly ClientNamespace[];

// Every platform page under one menu: the platform's own pages, and, inside the platform
// organization, its team, roles and docs. See packages/permissions/docs/reference/platform-scope.md.
export const Route = createFileRoute("/(app)/_authenticated/platform")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: PlatformLayout,
});

function PlatformLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const { session, queryClient } = Route.useRouteContext();
  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const organization = useMemo(() => new OrganizationClient(auth), [auth]);

  // The same refresh a switch from the header runs, landing back on the platform pages.
  const switchTo = OrganizationMutations.useSwitch(organization, () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to: "/platform" }),
    }),
  );

  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6">
        <PlatformNav
          renderLink={(href, label) => (
            <Link
              to={href}
              className="-mb-px block border-transparent border-b-2 px-1 pb-3 font-medium text-fg-muted text-sm no-underline hover:text-fg data-[status=active]:border-primary data-[status=active]:text-fg"
            >
              {label}
            </Link>
          )}
          onOpenPlatform={(organizationId) => switchTo.mutate({ organizationId })}
          opening={switchTo.isPending}
        />
      </div>
      <Outlet />
    </div>
  );
}
