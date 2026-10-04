import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Endpoint } from "~/endpoint.js";
import {
  AuthClient,
  type ClientNamespace,
  CreateOrganizationForm,
  OrganizationClient,
  Page,
  useMemo,
  useMessages,
} from "~/import.js";
import { refreshSession } from "~/route/-session.js";

const MESSAGES = ["organization"] as const satisfies readonly ClientNamespace[];

// Session-gated only: founding a tenant of your own is not a capability anyone in
// another tenant can grant or deny.
export const Route = createFileRoute("/(app)/_authenticated/organization/new")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: NewOrganizationPage,
});

function NewOrganizationPage() {
  const { t } = useMessages("organization");
  const { session, queryClient } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();

  const auth = useMemo(() => new AuthClient({ baseUrl: Endpoint.auth }), []);
  const organization = useMemo(() => new OrganizationClient(auth), [auth]);

  // The session now points at the new tenant, so everything cached belongs to the old
  // one — the same unwind a switch does.
  const created = () =>
    refreshSession({
      queryClient,
      session,
      invalidateRouter: () => router.invalidate(),
      go: () => void navigate({ to: "/" }),
    });

  return (
    <Page width="narrow">
      <h1>{t("organization.create.title")}</h1>
      <CreateOrganizationForm organization={organization} onCreated={created} />
    </Page>
  );
}
