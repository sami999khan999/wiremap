import { Password } from "@loadbearing/contracts";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordPair, passwordPairReady } from "../../src/auth/password-pair.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const render = (password: string, confirmation: string) =>
  renderWithFakes(
    <PasswordPair
      idPrefix="sign-up"
      label="Password"
      password={password}
      confirmation={confirmation}
      onPasswordChange={vi.fn()}
      onConfirmationChange={vi.fn()}
    />,
    capabilitiesWith([]),
  );

const short = "a".repeat(Password.MIN_LENGTH - 1);
const long = "a".repeat(Password.MIN_LENGTH);

describe("PasswordPair", () => {
  it("advertises the floor the server enforces", async () => {
    await render("", "");

    expect(screen.getByLabelText("Password").getAttribute("minLength")).toBe(
      String(Password.MIN_LENGTH),
    );
  });

  // An untouched field is not yet wrong: showing "too short" before anything is typed
  // makes every form open on an error.
  it("says nothing about an empty field", async () => {
    await render("", "");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names a password under the floor", async () => {
    await render(short, "");

    expect(screen.getByRole("alert").textContent).toContain("at least");
  });

  it("names a confirmation that does not match", async () => {
    await render(long, "different");

    expect(screen.getByRole("alert").textContent).toContain("match");
  });

  it("prefixes both ids, so two pairs on one page stay distinct", async () => {
    await render("", "");

    expect(screen.getByLabelText("Password").id).toBe("sign-up-password");
    expect(screen.getByLabelText("Confirm password").id).toBe("sign-up-confirmation");
  });

  it("reports the pair usable only when both are filled, long enough and equal", () => {
    expect(passwordPairReady(long, long)).toBe(true);
    expect(passwordPairReady(short, short)).toBe(false);
    expect(passwordPairReady(long, `${long}x`)).toBe(false);
    expect(passwordPairReady("", "")).toBe(false);
  });

  it("takes what the user types on each side", async () => {
    const onPasswordChange = vi.fn();
    const onConfirmationChange = vi.fn();

    await renderWithFakes(
      <PasswordPair
        idPrefix="reset"
        label="New password"
        password=""
        confirmation=""
        onPasswordChange={onPasswordChange}
        onConfirmationChange={onConfirmationChange}
      />,
      capabilitiesWith([]),
    );

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "b" } });

    expect(onPasswordChange).toHaveBeenCalledWith("a");
    expect(onConfirmationChange).toHaveBeenCalledWith("b");
  });
});
