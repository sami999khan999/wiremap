import type { AccountClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TwoFactorPanel } from "../../src/account/two-factor.panel.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const CODES = ["aaaa-bbbb", "cccc-dddd"];

const render = async () => {
  const disableTwoFactor = vi.fn().mockResolvedValue(undefined);
  const regenerateBackupCodes = vi.fn().mockResolvedValue(CODES);
  const account = { disableTwoFactor, regenerateBackupCodes } as unknown as AccountClient;

  await renderWithFakes(<TwoFactorPanel account={account} />, capabilitiesWith([]), TEST_USER, [
    "account",
  ]);
  return { disableTwoFactor, regenerateBackupCodes };
};

const typePassword = (value = "hunter2hunter2") =>
  fireEvent.change(screen.getByLabelText("Confirm your password to continue"), {
    target: { value },
  });

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("TwoFactorPanel", () => {
  it("regenerates the codes and shows the new ones", async () => {
    const { regenerateBackupCodes } = await render();

    typePassword();
    click("Generate new backup codes");

    await waitFor(() => expect(regenerateBackupCodes).toHaveBeenCalledWith("hunter2hunter2"));
    expect(await screen.findByText("aaaa-bbbb")).toBeDefined();
  });

  // The regression guard: the panel rendered on `regenerate.isSuccess`, which is sticky,
  // so codes for a factor that had just been turned off stayed on screen.
  it("takes the codes away when the factor is turned off", async () => {
    const { disableTwoFactor } = await render();

    typePassword();
    click("Generate new backup codes");
    expect(await screen.findByText("aaaa-bbbb")).toBeDefined();

    typePassword();
    click("Turn off two-factor");

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("aaaa-bbbb")).toBeNull());
  });

  it("takes the password for both, and clears it after each", async () => {
    await render();

    typePassword();
    click("Generate new backup codes");

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Confirm your password to continue") as HTMLInputElement).value,
      ).toBe(""),
    );
  });
});
