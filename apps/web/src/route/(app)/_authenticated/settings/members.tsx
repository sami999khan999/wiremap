import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Can,
  type ClientNamespace,
  InvitationLinkPanel,
  InvitationList,
  InviteMemberForm,
  MemberAccessPanel,
  MemberDomainPanel,
  MemberList,
  useCapabilities,
  useMessages,
  z,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

// `member` for this page's own copy; `role` because the invite form's role picker reads
// `RoleQueries.list`, and a role name arriving with no namespace loaded renders raw.
const MESSAGES = ["member", "role"] as const satisfies readonly ClientNamespace[];

// A uuid or nothing: anything else is dropped rather than sent to the server as a lookup.
const Search = z.object({ member: z.uuid().optional().catch(undefined) });

// Behind `member.read` — the same key the procedure is gated on and the use-case
// asserts. The invite and revoke affordances are behind `member.invite` separately.
export const Route = createFileRoute("/(app)/_authenticated/settings/members")({
  validateSearch: Search,
  beforeLoad: RouteGuard.requirePermission("member.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Members,
});

function Members() {
  const { t } = useMessages("member");
  const capabilities = useCapabilities();
  const navigate = useNavigate({ from: Route.fullPath });
  const { member } = Route.useSearch();
  // In the URL, so the panel survives a reload and a link to one member's access works.
  const open = (userId: string | undefined) =>
    void navigate({ search: userId ? { member: userId } : {} });

  return (
    <section className="flex flex-col gap-4">
      <h1>{t("member.title")}</h1>
      <p>{t("member.subtitle")}</p>
      <MemberList onOpenAccess={open} />
      {member ? <MemberAccessPanel userId={member} onClose={() => open(undefined)} /> : null}

      <h2>{t("member.invitation.title")}</h2>
      <InvitationList />

      <Can permission="member.invite" capabilities={capabilities}>
        <h2>{t("member.invite.title")}</h2>
        <InviteMemberForm />

        <h2>{t("member.links.title")}</h2>
        <InvitationLinkPanel linkFor={(token) => `${window.location.origin}/join/${token}`} />
      </Can>

      <h2>{t("member.domains.title")}</h2>
      <MemberDomainPanel editable={capabilities.can("member.domain.manage")} />
    </section>
  );
}
