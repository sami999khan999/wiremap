import type { AuthClient } from "@loadbearing/api-client";
import {
  AccountSuspendedError,
  InternalError,
  TwoFactorRequiredError,
  UnauthorizedError,
} from "@loadbearing/errors";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInForm } from "../../src/auth/sign-in.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

// Only the one method this form calls. A fuller double would be testing Better Auth.
const authThat = (signIn: AuthClient["signIn"]): AuthClient => ({ signIn }) as AuthClient;

const NONE = capabilitiesWith([]);

const fillAndSubmit = () => {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "ada@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "a-long-enough-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

const render = async (
  signIn: AuthClient["signIn"],
  props: Partial<Parameters<typeof SignInForm>[0]> = {},
) => {
  const onSuccess = vi.fn();
  const onNeedsTwoFactor = vi.fn();

  await renderWithFakes(
    <SignInForm
      auth={authThat(signIn)}
      onSuccess={onSuccess}
      onNeedsTwoFactor={onNeedsTwoFactor}
      {...props}
    />,
    NONE,
  );

  return { onSuccess, onNeedsTwoFactor };
};

describe("SignInForm", () => {
  it("signs in with what was typed and calls back", async () => {
    const signIn = vi.fn().mockResolvedValue(undefined);
    const { onSuccess } = await render(signIn);

    fillAndSubmit();

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("ada@example.test", "a-long-enough-password");
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // The fork arrives as a rejection so both legs share one path, and it is not a failed
  // sign-in: the notice under it would say the password was wrong when it was right.
  it("treats TWO_FACTOR_REQUIRED as a fork rather than a failure", async () => {
    const signIn = vi.fn().mockRejectedValue(new TwoFactorRequiredError());
    const { onSuccess, onNeedsTwoFactor } = await render(signIn);

    fillAndSubmit();

    await waitFor(() => {
      expect(onNeedsTwoFactor).toHaveBeenCalledTimes(1);
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Deliberately generic: distinguishing "no such account" from "wrong password" is an
  // account-enumeration oracle, so every other refusal renders the same sentence.
  it("says the same thing for every other refusal", async () => {
    const { onNeedsTwoFactor } = await render(
      vi.fn().mockRejectedValue(new UnauthorizedError("bad-credentials")),
    );

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That email and password did not match.");
    });
    expect(onNeedsTwoFactor).not.toHaveBeenCalled();
  });

  // Told only after the password matched, so naming the reason is no enumeration oracle.
  it("says the account is suspended rather than that the password was wrong", async () => {
    await render(vi.fn().mockRejectedValue(new AccountSuspendedError()));

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "This account has been suspended. Contact support to restore it.",
      );
    });
  });

  it("says it for a server failure too, rather than leaking the code", async () => {
    await render(vi.fn().mockRejectedValue(new InternalError()));

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That email and password did not match.");
    });
  });

  // Branch on the code, never the message: matching prose breaks the moment somebody
  // rewords it, and is already broken in every locale but English.
  it("does not take a message that merely contains the words for the code", async () => {
    const { onNeedsTwoFactor } = await render(
      vi.fn().mockRejectedValue(new Error("two factor required")),
    );

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).not.toBeNull();
    });
    expect(onNeedsTwoFactor).not.toHaveBeenCalled();
  });

  it("clears the fork before a second attempt, so a later failure shows its notice", async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(new TwoFactorRequiredError())
      .mockRejectedValueOnce(new UnauthorizedError("bad-credentials"));
    await render(signIn);

    fillAndSubmit();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByRole("alert")).not.toBeNull();
    });
  });
});
