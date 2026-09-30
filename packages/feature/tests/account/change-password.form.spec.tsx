import type { AccountClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "../../src/account/change-password.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const accountThat = (changePassword: AccountClient["changePassword"]): AccountClient =>
  ({ changePassword }) as AccountClient;

const LONG = "a-long-enough-password";

const render = async (changePassword: AccountClient["changePassword"]) =>
  renderWithFakes(
    <ChangePasswordForm account={accountThat(changePassword)} />,
    capabilitiesWith([]),
    undefined,
    // `PasswordPair` renders its confirmation label from the `auth` namespace.
    ["account", "auth"],
  );

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

const fill = (current: string, next: string, confirmation: string) => {
  fireEvent.change(field("Current password"), { target: { value: current } });
  fireEvent.change(field("New password"), { target: { value: next } });
  fireEvent.change(field("Confirm password"), { target: { value: confirmation } });
};

const submit = () => screen.getByRole("button", { name: "Change password" }) as HTMLButtonElement;

describe("ChangePasswordForm", () => {
  it("sends the current and the new password, in that order", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    await render(changePassword);

    fill("the-old-password", LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith("the-old-password", LONG);
    });
  });

  // Cleared on success, not left filled: a settings page that keeps three populated
  // password fields after a save is one stray click from re-submitting.
  it("empties all three fields once the change lands", async () => {
    await render(vi.fn().mockResolvedValue(undefined));

    fill("the-old-password", LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(field("Current password").value).toBe("");
    });
    expect(field("New password").value).toBe("");
    expect(field("Confirm password").value).toBe("");
  });

  // The copy says other devices were signed out, and `AccountClient` sets
  // `revokeOtherSessions` on the call — so the sentence is true rather than reassuring.
  it("says the other devices are signed out, only after it succeeded", async () => {
    await render(vi.fn().mockResolvedValue(undefined));

    expect(
      screen.queryByText("Your password is changed. Other devices have been signed out."),
    ).toBeNull();

    fill("the-old-password", LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(
        screen.getByText("Your password is changed. Other devices have been signed out."),
      ).toBeTruthy();
    });
  });

  it("leaves the fields filled when the current password was wrong", async () => {
    await render(vi.fn().mockRejectedValue(new Error("nope")));

    fill("the-wrong-password", LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(screen.getByText("That current password was not right.")).toBeTruthy();
    });
    // Retyping all three to correct one of them is the failure this avoids.
    expect(field("New password").value).toBe(LONG);
  });

  it("stays disabled until the new pair agrees and is long enough", async () => {
    const changePassword = vi.fn();
    await render(changePassword);

    fill("the-old-password", LONG, "a-different-password");
    expect(submit().disabled).toBe(true);

    fill("the-old-password", "short", "short");
    expect(submit().disabled).toBe(true);

    fill("the-old-password", LONG, LONG);
    expect(submit().disabled).toBe(false);
  });
});
