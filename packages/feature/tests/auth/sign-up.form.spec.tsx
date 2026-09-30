import type { AuthClient } from "@loadbearing/api-client";
import { ConflictError, InternalError } from "@loadbearing/errors";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignUpForm } from "../../src/auth/sign-up.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

// Only the one method this form calls. A fuller double would be testing Better Auth.
const authThat = (signUp: AuthClient["signUp"]): AuthClient => ({ signUp }) as AuthClient;

const NONE = capabilitiesWith([]);

const fill = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const fillValidForm = () => {
  fill("Your name", "Ada");
  fill("Email", "ada@example.test");
  fill("Password", "a-long-enough-password");
  fill("Confirm password", "a-long-enough-password");
};

describe("SignUpForm", () => {
  it("passes the verification callback through, so the link lands where the app decides", async () => {
    const signUp = vi.fn().mockResolvedValue(undefined);
    await renderWithFakes(
      <SignUpForm auth={authThat(signUp)} verifyCallbackUrl="/verify-email" onSuccess={vi.fn()} />,
      NONE,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith(
        "Ada",
        "ada@example.test",
        "a-long-enough-password",
        "/verify-email",
      );
    });
  });

  // The address, not just a signal. The next screen renders it back, and it exists only
  // in the form that is about to be replaced.
  it("hands the address to the caller, which is what the notice renders", async () => {
    const onSuccess = vi.fn();
    await renderWithFakes(
      <SignUpForm
        auth={authThat(vi.fn().mockResolvedValue(undefined))}
        verifyCallbackUrl="/verify-email"
        onSuccess={onSuccess}
      />,
      NONE,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("ada@example.test"));
  });

  // Never submitted at all, rather than submitted and rejected. A round trip to learn
  // that two fields disagree is a round trip that also clears them.
  it("does not submit a mismatched confirmation", async () => {
    const signUp = vi.fn();
    await renderWithFakes(
      <SignUpForm auth={authThat(signUp)} verifyCallbackUrl="/v" onSuccess={vi.fn()} />,
      NONE,
    );

    fill("Your name", "Ada");
    fill("Email", "ada@example.test");
    fill("Password", "a-long-enough-password");
    fill("Confirm password", "something-else-entirely");
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByText("Those passwords do not match.")).toBeDefined();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("does not submit a password under the server's floor", async () => {
    const signUp = vi.fn();
    await renderWithFakes(
      <SignUpForm auth={authThat(signUp)} verifyCallbackUrl="/v" onSuccess={vi.fn()} />,
      NONE,
    );

    fill("Password", "short");
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByText("Use at least 12 characters.")).toBeDefined();
    expect(signUp).not.toHaveBeenCalled();
  });

  // Branch on the code, never the message: matching prose breaks the moment somebody
  // rewords it, and is already broken in every locale but English.
  it("tells a returning user to sign in instead of reporting a failure", async () => {
    await renderWithFakes(
      <SignUpForm
        auth={authThat(vi.fn().mockRejectedValue(new ConflictError("user", "email")))}
        verifyCallbackUrl="/v"
        onSuccess={vi.fn()}
      />,
      NONE,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(
      await screen.findByText(
        "There is already an account with that email. Try signing in instead.",
      ),
    ).toBeDefined();
  });

  // Every other failure stays generic — CONFLICT is the one code this form is allowed
  // to be specific about, because sign-up cannot hide that an address is registered.
  it("stays generic about every other failure", async () => {
    await renderWithFakes(
      <SignUpForm
        auth={authThat(vi.fn().mockRejectedValue(new InternalError()))}
        verifyCallbackUrl="/v"
        onSuccess={vi.fn()}
      />,
      NONE,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(await screen.findByText("That account could not be created.")).toBeDefined();
  });
});
