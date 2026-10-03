import { useMessages } from "../i18n/index.js";
import {
  Button,
  type GraphDocument,
  GraphIndex,
  type ReactNode,
  RoleDot,
  useMemo,
} from "../import.js";
import { PLAIN_BUTTON, RoleTones } from "./role-tone.js";

export interface NodeDetailProps {
  readonly document: GraphDocument;
  readonly path: string;
  readonly impact: boolean;
  readonly onImpact: (on: boolean) => void;
  readonly onSelect: (path: string) => void;
  readonly onClose: () => void;
  readonly thread?: ReactNode;
}

function PathList({
  paths,
  onSelect,
  empty,
}: {
  readonly paths: readonly string[];
  readonly onSelect: (path: string) => void;
  readonly empty: string;
}) {
  if (paths.length === 0) return <p className="m-0 text-xs text-fg-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {paths.map((path) => (
        <li key={path}>
          <button
            type="button"
            onClick={() => onSelect(path)}
            className={`${PLAIN_BUTTON} w-full truncate rounded-sm px-1 py-0.5 text-left font-mono text-xs hover:bg-muted`}
          >
            {path}
          </button>
        </li>
      ))}
    </ul>
  );
}

// One file, or one folder: what it is, what it imports, what imports it, the routes it
// defines, and how far a change to it reaches.
export function NodeDetail({
  document,
  path,
  impact,
  onImpact,
  onSelect,
  onClose,
  thread,
}: NodeDetailProps) {
  const { t } = useMessages("graph");
  const index = useMemo(() => GraphIndex.from(document), [document]);
  const file = document.files.find((each) => each.path === path);
  const folderFiles = file ? [] : document.files.filter((each) => each.path.startsWith(`${path}/`));
  const imports = file ? index.imports(path) : [];
  const importers = file ? index.importers(path) : [];
  const routes = document.routes.filter((route) =>
    file ? route.file === path : route.file.startsWith(`${path}/`),
  );
  const reach = file && impact ? index.impact(path).length : 0;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 break-all font-mono text-sm font-semibold">{path}</h2>
        <Button variant="ghost" onClick={onClose}>
          {t("graph.detail.close")}
        </Button>
      </div>
      {file ? (
        <>
          <p className="m-0 flex items-center gap-2 text-sm">
            <RoleDot tone={RoleTones.of(file.role)} />
            {file.role}
            <span className="text-fg-muted">· {t("graph.detail.lines", { count: file.loc })}</span>
          </p>
          <div>
            <Button variant="secondary" onClick={() => onImpact(!impact)}>
              {impact ? t("graph.detail.impactOff") : t("graph.detail.impact")}
            </Button>
            {impact ? (
              <p className="m-0 mt-1 text-xs text-fg-muted">
                {t("graph.detail.impactCount", { count: reach })}
              </p>
            ) : null}
          </div>
          <section>
            <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
              {t("graph.detail.imports")}
            </h3>
            <PathList paths={imports} onSelect={onSelect} empty={t("graph.detail.none")} />
          </section>
          <section>
            <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
              {t("graph.detail.dependents")}
            </h3>
            <PathList paths={importers} onSelect={onSelect} empty={t("graph.detail.none")} />
          </section>
        </>
      ) : (
        <PathList
          paths={folderFiles.map((each) => each.path)}
          onSelect={onSelect}
          empty={t("graph.detail.none")}
        />
      )}
      <section>
        <h3 className="m-0 mb-1 text-xs font-semibold uppercase text-fg-muted">
          {t("graph.detail.routes")}
        </h3>
        {routes.length === 0 ? (
          <p className="m-0 text-xs text-fg-muted">{t("graph.detail.none")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-xs">
            {routes.map((route) => (
              <li key={route.id}>
                <span className="font-semibold">{route.method}</span> {route.path}{" "}
                <span className="text-fg-muted">:{route.line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {thread}
    </div>
  );
}
