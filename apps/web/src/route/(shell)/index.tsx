import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { type ClientNamespace, Icon, type IconName, useMessages } from "~/import.js";

// `nav` for this page's own copy; `common` rides in on the root loader.
const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

// Four points, each one icon and a key pair in `nav.landing`.
const POINTS = [
  { icon: "graph", key: "graph" },
  { icon: "route", key: "routes" },
  { icon: "activity", key: "insights" },
  { icon: "sparkle", key: "ask" },
] as const satisfies readonly { icon: IconName; key: string }[];

// The landing page for a visitor with no session. A signed-in one is sent to the
// dashboard, so every post-sign-in, post-switch and post-create navigation to `/` still lands.
export const Route = createFileRoute("/(shell)/")({
  beforeLoad: ({ context }) => {
    if (context.user) throw redirect({ to: "/dashboard" });
  },
  staticData: { messages: MESSAGES },
  loader: ({ context }) => context.messages.ensure(MESSAGES),
  component: Home,
});

const button =
  "inline-flex h-(--control-height) items-center rounded-md px-4 text-sm font-medium no-underline";

function Home() {
  const { t } = useMessages("nav");
  const { t: common } = useMessages("common");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-16 px-4 py-10 sm:py-16">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-base font-semibold">
          <Icon name="graph" size={20} className="text-primary" />
          {common("brand.name")}
        </span>
        <Link to="/sign-in" className="text-sm text-fg-muted no-underline hover:text-fg">
          {t("nav.home.goToSignIn")}
        </Link>
      </header>
      <section className="flex max-w-2xl flex-col gap-6">
        <h1 className="m-0 text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("nav.landing.title")}
        </h1>
        <p className="m-0 text-lg text-fg-muted">{t("nav.landing.lead")}</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/sign-up" className={`${button} bg-primary text-primary-fg`}>
            {t("nav.landing.start")}
          </Link>
          <Link to="/sign-in" className={`${button} border border-border text-fg`}>
            {t("nav.home.goToSignIn")}
          </Link>
        </div>
      </section>
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        {POINTS.map((point) => (
          <li
            key={point.key}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5"
          >
            <Icon name={point.icon} size={20} className="text-primary" />
            <h2 className="m-0 text-base font-semibold">
              {t(`nav.landing.${point.key}.title` as Parameters<typeof t>[0])}
            </h2>
            <p className="m-0 text-sm text-fg-muted">
              {t(`nav.landing.${point.key}.body` as Parameters<typeof t>[0])}
            </p>
          </li>
        ))}
      </ul>
      <footer className="border-t border-border pt-6 text-sm">
        <Link to="/privacy" className="text-fg-muted no-underline hover:text-fg">
          {t("nav.privacy.link")}
        </Link>
      </footer>
    </main>
  );
}
