import { createFileRoute, Link } from "@tanstack/react-router";
import { type ClientNamespace, Icon, useMessages } from "~/import.js";

const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

// Each section is a title and a body in `nav.privacy`; the order is the order a reader asks.
const SECTIONS = ["kept", "never", "local", "ask", "where", "delete"] as const;

// Public, so it is readable before an account exists.
export const Route = createFileRoute("/(shell)/privacy")({
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Privacy,
});

function Privacy() {
  const { t } = useMessages("nav");
  const { t: common } = useMessages("common");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:py-16">
      <header>
        <Link
          to="/"
          className="flex items-center gap-2 font-mono text-base font-semibold text-fg no-underline"
        >
          <Icon name="graph" size={20} className="text-primary" />
          {common("brand.name")}
        </Link>
      </header>
      <section className="flex flex-col gap-3">
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{t("nav.privacy.title")}</h1>
        <p className="m-0 text-lg text-fg-muted">{t("nav.privacy.lead")}</p>
      </section>
      {SECTIONS.map((section) => (
        <section key={section} className="flex flex-col gap-2">
          <h2 className="m-0 text-lg font-semibold">
            {t(`nav.privacy.${section}.title` as Parameters<typeof t>[0])}
          </h2>
          <p className="m-0 leading-relaxed text-fg-muted">
            {t(`nav.privacy.${section}.body` as Parameters<typeof t>[0])}
          </p>
        </section>
      ))}
    </main>
  );
}
