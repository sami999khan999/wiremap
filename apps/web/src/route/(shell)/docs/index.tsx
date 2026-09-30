import { createFileRoute, Link } from "@tanstack/react-router";
import { type ClientNamespace, DocSpaceList, readerClassName, useMessages } from "~/import.js";
import { DocLink } from "~/route/-doc-link.js";
import { fetchPlatformDocSpaces } from "~/server/doc.fn.js";
import { DocCacheHeaders } from "./-cache.js";

const MESSAGES = ["doc"] as const satisfies readonly ClientNamespace[];

// The platform's documentation, for anyone: the public spaces, and the granted ones this
// reader has been let into. Needs no session, which is why it is under `(shell)`.
export const Route = createFileRoute("/(shell)/docs/")({
  staticData: { messages: MESSAGES },
  loader: async ({ context }) => {
    const [, result] = await Promise.all([
      context.messages.ensure(MESSAGES),
      fetchPlatformDocSpaces(),
    ]);
    return result;
  },
  headers: ({ loaderData }) => DocCacheHeaders.of(loaderData?.cacheable),
  component: PublicDocHome,
});

function PublicDocHome() {
  const { t } = useMessages("doc");
  const { spaces } = Route.useLoaderData();

  return (
    <main id="main" className={readerClassName.content}>
      <div className="ui-stack">
        <nav className={readerClassName.actions}>
          <Link to="/">{t("doc.back.home")}</Link>
        </nav>
        <header className={readerClassName.header}>
          <h1 className={readerClassName.title}>{t("doc.home.public")}</h1>
        </header>
        <DocSpaceList spaces={spaces} root="/docs" renderLink={DocLink.render} />
      </div>
    </main>
  );
}
