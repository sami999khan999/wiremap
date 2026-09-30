import type { AuthClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "../../src/auth/reset-password.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const authThat = (resetPassword: AuthClient["resetPassword"]): AuthClient =>
  ({ resetPassword }) as AuthClient;

const LONG = "a-long-enough-password";

const render = async (resetPassword: AuthClient["resetPassword"]) => {
  const onSuccess = vi.fn();

  await renderWithFakes(
    <ResetPasswordForm auth={authThat(resetPassword)} token="tok" onSuccess={onSuccess} />,
    capabilitiesWith([]),
  );

  return { onSuccess };
};

const fill = (password: string, confirmation: string) => {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: confirmation },
  });
};

const submit = () => screen.getByRole("button", { name: "Save this password" });

// `toBeDisabled` is a jest-dom matcher and this package registers none of them.
const disabled = () => (submit() as HTMLButtonElement).disabled;

describe("ResetPasswordForm", () => {
  // The token is opaque here on purpose: the route validates its presence, and a
  // component that inspected it would be a second place to get the shape wrong.
  it("sends the token it was handed, untouched, with the new password", async () => {
    const resetPassword = vi.fn().mockResolvedValue(undefined);
    const { onSuccess } = await render(resetPassword);

    fill(LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith("tok", LONG);
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // Twelve characters and both fields agreeing. Enforced by disabling rather than by a
  // message, so there is nothing to submit past.
  it("stays disabled until the pair agrees and is long enough", async () => {
    await render(vi.fn());

    expect(disabled()).toBe(true);

    fill(LONG, "");
    expect(disabled()).toBe(true);

    fill(LONG, "a-different-password");
    expect(disabled()).toBe(true);

    fill("short", "short");
    expect(disabled()).toBe(true);

    fill(LONG, LONG);
    expect(disabled()).toBe(false);
  });

  // One message for expired and already-spent alike: both mean "ask for another", and
  // telling them apart tells an attacker which links have been used.
  it("says the same thing however the reset was refused", async () => {
    await render(vi.fn().mockRejectedValue(new Error("whatever the server said")));

    fill(LONG, LONG);
    fireEvent.click(submit());

    await waitFor(() => {
      expect(
        screen.getByText("That reset link has expired or has already been used."),
      ).toBeTruthy();
    });
  });
});
