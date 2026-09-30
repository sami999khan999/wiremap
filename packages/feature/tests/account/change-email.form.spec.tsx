import type { AccountClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangeEmailForm } from "../../src/account/change-email.form.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const render = (changeEmail = vi.fn().mockResolvedValue(undefined)) => {
  const account = { changeEmail } as unknown as AccountClient;
  return renderWithFakes(
    <ChangeEmailForm account={account} callbackUrl="/settings/account" />,
    capabilitiesWith([]),
    TEST_USER,
    ["account"],
  ).then(() => ({ changeEmail }));
};

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("New email address"), { target: { value } });

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Change email address" }));

describe("ChangeEmailForm", () => {
  it("sends the address and the callback the link returns to", async () => {
    const { changeEmail } = await render();

    type("new@example.test");
    submit();

    await waitFor(() =>
      expect(changeEmail).toHaveBeenCalledWith("new@example.test", "/settings/account"),
    );
  });

  // The regression guard: the field kept its value and the button stayed live, so a
  // second click sent a second confirmation to the same inbox for the same change.
  it("clears the field and refuses a second submit of the same address", async () => {
    const { changeEmail } = await render();

    type("new@example.test");
    submit();

    await waitFor(() => expect(changeEmail).toHaveBeenCalledTimes(1));

    expect((screen.getByLabelText("New email address") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Change email address" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says the confirmation went to the current address, not that anything changed", async () => {
    await render();

    type("new@example.test");
    submit();

    expect(await screen.findByText(/current address/)).toBeDefined();
  });
});
