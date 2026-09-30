import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button, type ClientNamespace, EmptyState, useMessages } from "~/import.js";

// `nav` for this page's own copy; `common` rides in on the root loader.
const MESSAGES = ["nav"] as const satisfies readonly ClientNamespace[];

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

function Home() {
  const { t } = useMessages("nav");

  return (
    <main>
      <EmptyState
        title={t("nav.home.signedOut")}
        action={
          <Link to="/sign-in">
            <Button>{t("nav.home.goToSignIn")}</Button>
          </Link>
        }
      />
    </main>
  );
}
