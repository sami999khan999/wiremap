import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  InvitationAccept,
  OrganizationClient,
  useMemo,
  useMessages,
} from "~/import.js";
import { AuthFrame } from "~/route/-auth-frame.js";
import { refreshSession } from "~/route/-session.js";
import { fetchInvitation } from "~/server/invitation.fn.js";

const MESSAGES = ["organization", "auth"] as const satisfies readonly ClientNamespace[];

// Where an invitation link lands. Under `(shell)` because the person holding it may have
// no account yet, and the page has to make sense to them too.
export const Route = createFileRoute("/(shell)/invitation/$token")({
  staticData: { messages: MESSAGES },
  loader: async ({ context, params }) => {
    const [, preview] = await Promise.all([
      context.messages.ensure(MESSAGES),
      fetchInvitation({ data: { token: params.token } }),
    ]);
    return { preview };
  },
  component: InvitationPage,
});

function InvitationPage() {
  const { t } = useMessages("organization");
  const { preview } = Route.useLoaderData();
  const { token } = Route.useParams();
  const { session, queryClient } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();

  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const organization = useMemo(() => new OrganizationClient(auth), [auth]);

  // The session now points at a tenant this tab has never loaded, so nothing cached is
  // trustworthy — the same unwind a switch does.
  const accepted = () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to: "/" }),
    });

  return (
    <AuthFrame>
      <h1>{t("organization.invitation.title")}</h1>
      <InvitationAccept
        preview={preview}
        token={token}
        organization={organization}
        onAccepted={accepted}
        // Back here once signed in, so the accept button is one click away.
        onSignIn={() =>
          void navigate({ to: "/sign-in", search: { redirect: `/invitation/${token}` } })
        }
        // A new account needs no redirect: its first sign-in claims the invitation by
        // verified address.
        onSignUp={() => void navigate({ to: "/sign-up" })}
      />
    </AuthFrame>
  );
}
