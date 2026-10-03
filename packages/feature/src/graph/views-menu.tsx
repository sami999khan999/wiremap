import { useCapabilities } from "../auth/index.js";
import { useMessages } from "../i18n/index.js";
import {
  Button,
  type GraphViewDto,
  Input,
  type LinkAttributes,
  Popover,
  type ProjectId,
  type ReactNode,
  useApiClient,
  useAppQuery,
  useState,
  ViewMutations,
  ViewQueries,
} from "../import.js";
import { PLAIN_BUTTON } from "./role-tone.js";

export interface ViewsMenuProps {
  readonly projectId: ProjectId;
  // The explorer's current query string, which is what a view saves.
  readonly state: string;
  readonly currentUserId: string | null;
  // `?<state>` on the project page, as the router's link.
  readonly renderLink: (state: string, content: ReactNode, attributes: LinkAttributes) => ReactNode;
}

// Saved views: the current explorer state under a name, shared with everyone who can read
// the project. Removing one is its author's, or a project admin's.
export function ViewsMenu({ projectId, state, currentUserId, renderLink }: ViewsMenuProps) {
  const { t } = useMessages("graph");
  const client = useApiClient();
  const capabilities = useCapabilities();
  const views = useAppQuery(ViewQueries.list(client, projectId));
  const save = ViewMutations.useSave(client);
  const remove = ViewMutations.useRemove(client);
  const [name, setName] = useState("");
  // Annotated: the procedure types cross two packages, and a break degrades to `any`.
  const rows: readonly GraphViewDto[] = views.data ?? [];
  const canRemove = (view: GraphViewDto) =>
    view.createdBy === currentUserId || capabilities.can("project.settings.manage", projectId);

  return (
    <Popover
      label={t("graph.view.saved")}
      trigger={t("graph.view.saved")}
      variant="secondary"
      align="start"
    >
      <div className="flex w-72 flex-col gap-3 p-3">
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-fg-muted">{t("graph.view.none")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((view) => (
              <li key={view.id} className="flex items-center justify-between gap-2">
                {renderLink(view.state, view.name, {
                  className: "min-w-0 flex-1 truncate text-sm",
                })}
                {canRemove(view) ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate({ projectId, viewId: view.id })}
                    className={`${PLAIN_BUTTON} text-xs text-fg-muted hover:text-fg`}
                  >
                    {t("graph.view.remove")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === "") return;
            save.mutate({ projectId, name: name.trim(), state }, { onSuccess: () => setName("") });
          }}
        >
          <Input
            aria-label={t("graph.view.name")}
            placeholder={t("graph.view.name")}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={save.isPending || name.trim() === ""}>
            {t("graph.view.save")}
          </Button>
        </form>
      </div>
    </Popover>
  );
}
