import { useMessages } from "../i18n/index.js";
import { ActionMenu, type AuthClient, Avatar, Callout, Icon, SessionMutations } from "../import.js";
import { useSession } from "./session.context.js";

export interface UserMenuProps {
  readonly auth: AuthClient;
  // Runs after the cookie is gone; the call site clears the cache and navigates.
  readonly onSignedOut: () => void;
  // Callbacks, because `feature` may not import routing.
  readonly onAccount: () => void;
  readonly onSecurity: () => void;
  // `sidebar`: a full-width row at the foot of the app's sidebar, opening upwards.
  readonly placement?: "bar" | "sidebar";
}

// The avatar at the right of the top bar: who is signed in, their own pages, and sign-out.
export function UserMenu({
  auth,
  onSignedOut,
  onAccount,
  onSecurity,
  placement = "bar",
}: UserMenuProps) {
  const { t } = useMessages("nav");
  const { user } = useSession();
  const signOut = SessionMutations.useSignOut(auth, onSignedOut);

  if (!user) return null;

  return (
    <>
      <ActionMenu
        label={t("nav.userMenu")}
        {...(placement === "sidebar"
          ? { side: "top" as const, align: "start" as const, className: "w-full px-2 py-1.5" }
          : {})}
        trigger={
          placement === "sidebar" ? (
            <>
              <Avatar name={user.name || user.email} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="truncate text-sm font-medium">{user.name || user.email}</span>
                <span className="truncate text-xs text-fg-muted">{user.email}</span>
              </span>
              <Icon name="chevron-up-down" size={14} className="shrink-0 text-fg-muted" />
            </>
          ) : (
            <Avatar name={user.name || user.email} />
          )
        }
        header={
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs text-fg-muted">{user.email}</span>
          </div>
        }
        entries={[
          {
            kind: "item",
            key: "account",
            label: t("nav.account"),
            icon: "user",
            onSelect: onAccount,
          },
          {
            kind: "item",
            key: "security",
            label: t("nav.security"),
            icon: "shield",
            onSelect: onSecurity,
          },
          { kind: "separator", key: "separator" },
          {
            kind: "item",
            key: "sign-out",
            label: t("nav.signOut"),
            icon: "logout",
            tone: "danger",
            disabled: signOut.isPending,
            onSelect: () => signOut.mutate(),
          },
        ]}
      />
      {
        // A refused sign-out leaves the session live, so the shell must say so.
      }
      {signOut.isError ? <Callout tone="danger">{t("nav.signOutFailed")}</Callout> : null}
    </>
  );
}
