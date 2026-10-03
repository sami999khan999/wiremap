import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "../../../src/component/action-menu/action-menu.js";

describe("ActionMenu", () => {
  it("opens from its trigger and runs the chosen action", async () => {
    const signOut = vi.fn();
    render(
      <ActionMenu
        label="Account"
        trigger={<span>SK</span>}
        header={<span>sami@example.test</span>}
        entries={[
          { kind: "item", key: "settings", label: "Settings", onSelect: vi.fn() },
          { kind: "separator", key: "s" },
          { kind: "item", key: "out", label: "Sign out", tone: "danger", onSelect: signOut },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy());
    expect(screen.getByText("sami@example.test")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
