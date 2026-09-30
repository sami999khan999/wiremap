import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type ClientNamespace,
  DocGrantPanel,
  DocQueries,
  type DocSpaceDto,
  DocSpaceForm,
  readerClassName,
  StatusBadge,
  useApiClient,
  useAppQuery,
  useCapabilities,
  useIsPlatformOrganization,
  useMessages,
} from "~/import.js";
import { RouteGuard } from "~/route/-guard.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// The spaces, each with its settings and a way into its pages. A writer sees the list;
// only `doc.space.manage` sees the forms, and the server refuses either way.
export const Route = createFileRoute("/(app)/doc/manage/")({
  beforeLoad: RouteGuard.requirePermission("doc.page.write"),
  staticData: { messages: MESSAGES },
  loader: ({ context }) =>
    Promise.all([
      context.messages.ensure(MESSAGES),
      context.queryClient.ensureQueryData(DocQueries.spaces(context.api)),
    ]),
  component: DocManage,
});

function DocManage() {
  const { t } = useMessages("doc");
  const client = useApiClient();
  const spaces = useAppQuery(DocQueries.spaces(client));
  const capabilities = useCapabilities();
  const manage = capabilities.can("doc.space.manage");
  const grant = capabilities.can("platform.doc.grant");
  const platform = useIsPlatformOrganization();
  const items: readonly DocSpaceDto[] = spaces.data?.items ?? [];

  return (
    <main id="main" className={readerClassName.content}>
      <div className="ui-stack flex flex-col gap-3">
        <nav className={readerClassName.actions}>
          <Link to="/doc">{t("doc.home.title")}</Link>
        </nav>
        <header className={readerClassName.header}>
          <h1 className={readerClassName.title}>{t("doc.manage.title")}</h1>
          <p className={readerClassName.description}>{t("doc.manage.description")}</p>
        </header>

        <section className="ui-stack flex flex-col gap-3" aria-labelledby="doc-spaces">
          <h2 id="doc-spaces">{t("doc.manage.spaces")}</h2>
          {items.length === 0 ? <p>{t("doc.manage.empty")}</p> : null}
          {items.map((space) => (
            <details key={space.id} className="ui-stack flex flex-col gap-3">
              <summary>
                <strong>{space.title}</strong>{" "}
                <StatusBadge tone={space.audience === "members" ? "neutral" : "accent"}>
                  {t(`doc.space.audience.${space.audience}`)}
                </StatusBadge>
              </summary>
              <div className={readerClassName.actions}>
                <Link to="/doc/$space/$" params={{ space: space.slug, _splat: "" }}>
                  {t("doc.space.open")}
                </Link>
                <Link to="/doc/manage/$spaceId" params={{ spaceId: space.id }}>
                  {t("doc.space.edit")}
                </Link>
              </div>
              {manage ? <DocSpaceForm space={space} platform={platform} /> : null}
              {
                // Only the platform's own spaces have outside readers to name.
                grant && platform && space.audience === "granted" ? (
                  <DocGrantPanel spaceId={space.id} />
                ) : null
              }
            </details>
          ))}
        </section>

        {manage ? (
          <section className="ui-stack flex flex-col gap-3" aria-labelledby="doc-new-space">
            <h2 id="doc-new-space">{t("doc.manage.new")}</h2>
            <DocSpaceForm platform={platform} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
