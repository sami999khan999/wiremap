import { Link } from "@tanstack/react-router";
import { Icon, type ReactNode, useMessages } from "~/import.js";

export interface AuthFrameProps {
  readonly children: ReactNode;
}

// The signed-out pages' one column: the wordmark, then the form, centred and narrow.
// It renders the page's `<main>`, since these pages sit under no layout that has one.
export function AuthFrame({ children }: AuthFrameProps) {
  const { t } = useMessages("common");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Link
        to="/"
        className="flex items-center gap-2 font-mono text-base font-semibold text-fg no-underline"
      >
        <Icon name="graph" size={20} className="text-primary" />
        {t("brand.name")}
      </Link>
      <div className="ui-auth-frame flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 [&_nav]:flex [&_nav]:justify-between [&_nav]:gap-2 [&_nav]:text-sm">
        {children}
      </div>
    </main>
  );
}
