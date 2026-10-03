import { Link } from "@tanstack/react-router";
import {
  EmptyState,
  ExplorerUrl,
  type GraphDocument,
  type GraphLinkDto,
  type ProjectDto,
  type ReactNode,
  type ScanDto,
  ScanQueries,
  useApiClient,
  useAppQuery,
  useMessages,
} from "~/import.js";

// One scan's graph for a project page that is not the explorer: the signed link, then the
// file. `scanId` null is the latest that succeeded.
export function useProjectGraph(projectId: ProjectDto["id"], scanId: ScanDto["id"] | null) {
  const client = useApiClient();
  const link = useAppQuery(ScanQueries.graph(client, projectId, scanId));
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const data: GraphLinkDto | undefined = link.data;
  const document = useAppQuery({
    ...ScanQueries.document(data ?? { scanId: "" as ScanDto["id"], url: "" }),
    enabled: data !== undefined,
  });
  const graph: GraphDocument | undefined = document.data;
  return {
    pending: link.isPending || (data !== undefined && document.isPending),
    graph,
    missing: !link.isPending && !data,
  };
}

// The empty and loading states every graph page shares.
export function GraphGate({
  pending,
  missing,
  children,
}: {
  readonly pending: boolean;
  readonly missing: boolean;
  readonly children: ReactNode;
}) {
  const { t } = useMessages("graph");
  const scan = useMessages("scan");
  if (pending) return <p className="m-0 text-sm text-fg-muted">{t("graph.loading")}</p>;
  if (missing)
    return (
      <EmptyState
        icon="graph"
        title={scan.t("scan.empty")}
        description={scan.t("scan.empty.description")}
      />
    );
  return <>{children}</>;
}

// A path as a link into the explorer, selecting it with its folder open.
export const pathLink =
  (slug: string) =>
  (path: string, content: ReactNode): ReactNode => (
    <Link
      to="/p/$project"
      params={{ project: slug }}
      search={ExplorerUrl.select(path)}
      className="min-w-0 truncate no-underline hover:underline"
    >
      {content}
    </Link>
  );
