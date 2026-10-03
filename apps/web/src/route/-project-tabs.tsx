import { Link } from "@tanstack/react-router";
import { useCapabilities, useMessages } from "~/import.js";

// `data-status` is what TanStack's `Link` sets on the active one; two border colours as
// plain classes leave which one wins to the stylesheet's order.
const linkClass =
  "border-b-2 border-transparent px-1 pb-2 text-sm text-fg-muted no-underline hover:text-fg data-[status=active]:border-primary data-[status=active]:text-fg";

// A project's pages, as tabs under its name. Settings only for someone who manages it.
export function ProjectTabs({
  slug,
  projectId,
}: {
  readonly slug: string;
  readonly projectId: string;
}) {
  const { t } = useMessages("project");
  const scan = useMessages("scan");
  const capabilities = useCapabilities();
  const manages = (
    ["project.settings.manage", "project.access.manage", "project.delete"] as const
  ).some((key) => capabilities.can(key, projectId));
  return (
    <nav
      aria-label={t("project.title")}
      className="flex gap-4 overflow-x-auto border-b border-border"
    >
      <Link
        to="/p/$project"
        params={{ project: slug }}
        activeOptions={{ exact: true, includeSearch: false }}
        className={linkClass}
      >
        {t("project.overview")}
      </Link>
      <Link to="/p/$project/scans" params={{ project: slug }} className={linkClass}>
        {scan.t("scan.title")}
      </Link>
      {manages ? (
        <Link to="/p/$project/settings" params={{ project: slug }} className={linkClass}>
          {t("project.settings")}
        </Link>
      ) : null}
    </nav>
  );
}
