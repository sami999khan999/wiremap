import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageProvider, useMessages } from "../../src/i18n/message.context.js";
import { messageStore } from "../support/render-with-fakes.js";

function AuthCopy() {
  const { t, locale } = useMessages("auth");
  return (
    <p>
      {locale}:{t("auth.signIn")}:{t("action.cancel")}
    </p>
  );
}

function NavCopy() {
  const { t } = useMessages("nav");
  return <p>{t("nav.roles")}</p>;
}

describe("useMessages", () => {
  it("reads its own namespace and the always-loaded shell", async () => {
    const messages = await messageStore(["auth"]);
    render(
      <MessageProvider messages={messages}>
        <AuthCopy />
      </MessageProvider>,
    );

    // `action.cancel` needs no declaration: every ContentSource puts the shell in every
    // snapshot, and the type union says exactly that.
    expect(screen.getByText("en:Sign in:Cancel")).toBeDefined();
  });

  it("throws outside a provider, naming the provider", () => {
    expect(() => render(<AuthCopy />)).toThrow(/MessageProvider/);
  });

  // The documented failure mode, and the reason it is the right one: a raw key on screen
  // names the exact string to grep for, and the bug is a route that forgot a namespace.
  it("renders the key itself for an undeclared namespace", async () => {
    const messages = await messageStore(["auth"]);
    render(
      <MessageProvider messages={messages}>
        <NavCopy />
      </MessageProvider>,
    );

    expect(screen.getByText("nav.roles")).toBeDefined();
  });

  // `useSyncExternalStore` exists for this: navigation adds namespaces after the
  // provider mounted, and the tree has to re-render when it does.
  it("re-renders when ensure() adds a namespace", async () => {
    const messages = await messageStore([]);
    render(
      <MessageProvider messages={messages}>
        <NavCopy />
      </MessageProvider>,
    );

    expect(screen.getByText("nav.roles")).toBeDefined();

    await messages.ensure(["nav"]);

    await waitFor(() => expect(screen.getByText("Roles")).toBeDefined());
  });
});
