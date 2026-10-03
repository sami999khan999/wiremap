import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ProjectDto, ProjectQueries, z } from "~/import.js";

// Where a notification about a project points: the link carries the id, which never
// changes, and this turns it into the slug page the reader can see today.
const Search = z.object({
  to: z.enum(["graph", "scans", "insights", "activity"]).optional().catch(undefined),
  sel: z.string().max(1_100).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/_authenticated/go/project/$projectId")({
  validateSearch: Search,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, params, deps }) => {
    const page = await context.queryClient.ensureQueryData(
      ProjectQueries.list(context.api, { limit: 100, offset: 0 }),
    );
    const project: ProjectDto | undefined = page.items.find(
      (each: ProjectDto) => each.id === params.projectId,
    );
    if (!project) throw redirect({ to: "/projects" });
    const slug = { project: project.slug };
    switch (deps.to) {
      case "scans":
        throw redirect({ to: "/p/$project/scans", params: slug });
      case "insights":
        throw redirect({ to: "/p/$project/insights", params: slug });
      case "activity":
        throw redirect({ to: "/p/$project/activity", params: slug });
      default:
        throw redirect({
          to: "/p/$project",
          params: slug,
          search: deps.sel ? { sel: deps.sel } : {},
        });
    }
  },
});
