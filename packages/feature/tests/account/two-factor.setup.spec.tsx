import type { AccountClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TwoFactorSetup } from "../../src/account/two-factor.setup.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const CODES = ["aaaa-bbbb", "cccc-dddd"];
const URI = "otpauth://totp/Loadbearing:ada@example.test?secret=ABC";

const render = async (over: Partial<AccountClient> = {}) => {
  const enableTwoFactor = vi.fn().mockResolvedValue({ totpUri: URI, backupCodes: CODES });
  const verifyTotpEnrolment = vi.fn().mockResolvedValue(undefined);
  const account = { enableTwoFactor, verifyTotpEnrolment, ...over } as unknown as AccountClient;
  const onEnabled = vi.fn();

  await renderWithFakes(
    <TwoFactorSetup account={account} onEnabled={onEnabled} />,
    capabilitiesWith([]),
    TEST_USER,
    ["account"],
  );

  return { enableTwoFactor, verifyTotpEnrolment, onEnabled };
};

const passwordField = () =>
  screen.getByLabelText("Confirm your password to continue") as HTMLInputElement;

const start = async (password = "hunter2hunter2") => {
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
  await waitFor(() => {
    expect(screen.getByLabelText("Authentication code")).toBeTruthy();
  });
};

const verify = (code = "123456") => {
  fireEvent.change(screen.getByLabelText("Authentication code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
};

describe("TwoFactorSetup — the password step", () => {
  // The password stops a stolen session enrolling its own authenticator and locking the
  // owner out permanently.
  it("will not start without one", async () => {
    const { enableTwoFactor } = await render();

    expect(
      (screen.getByRole("button", { name: "Turn on two-factor" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(enableTwoFactor).not.toHaveBeenCalled();
  });

  // Dropped as soon as it is spent: holding it is a password sitting in a React tree for
  // no further reason.
  it("does not carry the password into the next step", async () => {
    await render();

    await start();

    expect(screen.queryByLabelText("Confirm your password to continue")).toBeNull();
  });
});

describe("TwoFactorSetup — the verify step", () => {
  // Enabling on the strength of a QR nobody scanned locks someone out at their next
  // sign-in, which is why the third step is not ceremony.
  it("shows the secret to scan and the same string to type, and asks for a code", async () => {
    await render();

    await start();

    expect(
      (screen.getByLabelText("Cannot scan? Enter this key by hand instead.") as HTMLInputElement)
        .value,
    ).toBe(URI);
    expect(screen.queryByText("Backup codes")).toBeNull();
  });

  it("does not finish on a code the server refused", async () => {
    const { onEnabled } = await render({
      verifyTotpEnrolment: vi.fn().mockRejectedValue(new Error("nope")),
    });

    await start();
    verify("000000");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That code was not right.");
    });
    expect(onEnabled).not.toHaveBeenCalled();
    expect(screen.queryByText("Backup codes")).toBeNull();
  });
});

describe("TwoFactorSetup — the codes", () => {
  // Shown once and never again — `viewBackupCodes` is server-only and deliberately not
  // reachable from the client — so this render is the only chance to write them down.
  it("shows the codes only once the enrolment is verified", async () => {
    const { verifyTotpEnrolment } = await render();

    await start();
    for (const code of CODES) expect(screen.queryByText(code)).toBeNull();

    verify();

    await waitFor(() => {
      expect(screen.getByText("Two-factor is on.")).toBeTruthy();
    });
    expect(verifyTotpEnrolment).toHaveBeenCalledWith("123456");
    for (const code of CODES) expect(screen.getByText(code)).toBeTruthy();
  });
});
