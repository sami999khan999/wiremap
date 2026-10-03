import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  InvitationLinkJoin,
  OrganizationClient,
  useMemo,
} from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";
import { refreshSession } from "~/route/-session.js";
import { fetchInvitationLink } from "~/server/invitation.fn.js";

const MESSAGES = ["organization", "auth"] as const satisfies readonly ClientNamespace[];

// Where a shareable invitation link lands. Under `(shell)`, as `/invitation/$token` is:
// whoever holds the link may have no account yet.
export const Route = createFileRoute("/(shell)/join/$token")({
  staticData: { messages: MESSAGES },
  loader: async ({ context, params }) => {
    const [, preview] = await Promise.all([
      context.messages.ensure(MESSAGES),
      fetchInvitationLink({ data: { token: params.token } }),
    ]);
    return { preview };
  },
  component: JoinPage,
});

function JoinPage() {
  const { preview } = Route.useLoaderData();
  const { token } = Route.useParams();
  const { session, queryClient } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();

  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const organization = useMemo(() => new OrganizationClient(auth), [auth]);

  const joined = () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to: "/" }),
    });

  return (
    <AuthFrame>
      <InvitationLinkJoin
        preview={preview}
        token={token}
        organization={organization}
        onJoined={joined}
        // Back here once signed in or verified, so joining is one click away.
        onSignIn={() => void navigate({ to: "/sign-in", search: { redirect: `/join/${token}` } })}
        onSignUp={() => void navigate({ to: "/sign-up" })}
      />
    </AuthFrame>
  );
}
