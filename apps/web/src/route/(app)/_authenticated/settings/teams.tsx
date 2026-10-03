import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ClientNamespace, TeamList, TeamMembersPanel, useMessages, z } from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["team", "member"] as const satisfies readonly ClientNamespace[];

// The open team in the URL, as the members page keeps the open member.
const Search = z.object({ team: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute("/(app)/_authenticated/settings/teams")({
  validateSearch: Search,
  beforeLoad: RouteGuard.requirePermission("member.read"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Teams,
});

function Teams() {
  const { t } = useMessages("team");
  const navigate = useNavigate({ from: Route.fullPath });
  const { team } = Route.useSearch();
  const open = (teamId: string | undefined) =>
    void navigate({ search: teamId ? { team: teamId } : {} });

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-2xl font-semibold">{t("team.title")}</h1>
        <p className="m-0 mt-1 text-sm text-fg-muted">{t("team.intro")}</p>
      </div>
      <TeamList onOpen={open} />
      {team ? <TeamMembersPanel key={team} teamId={team} onClose={() => open(undefined)} /> : null}
    </section>
  );
}
