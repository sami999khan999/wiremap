import type { AuthClient } from "@loadbearing/api-client";
import { UnauthorizedError } from "@loadbearing/errors";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TwoFactorForm } from "../../src/auth/two-factor.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const NONE = capabilitiesWith([]);

function authDouble(overrides: Partial<AuthClient> = {}) {
  return {
    verifyTwoFactor: vi.fn().mockResolvedValue(undefined),
    verifyBackupCode: vi.fn().mockResolvedValue(undefined),
    sendTwoFactorOtp: vi.fn().mockResolvedValue(undefined),
    verifyTwoFactorOtp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthClient & Record<string, ReturnType<typeof vi.fn>>;
}

const typeCode = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("TwoFactorForm — the three factors", () => {
  it("verifies a TOTP code by default", async () => {
    const auth = authDouble();
    const onSuccess = vi.fn();
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={onSuccess} />, NONE);

    typeCode("Authentication code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(auth.verifyTwoFactor).toHaveBeenCalledWith("123456"));
    expect(onSuccess).toHaveBeenCalled();
  });

  // The way out for someone whose phone is gone. Without it, enrolling two-factor is a
  // one-way door and the recovery codes are decorative.
  it("verifies a backup code once the user switches to it", async () => {
    const auth = authDouble();
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={vi.fn()} />, NONE);

    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    typeCode("Backup code", "abcd-efgh-ij");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(auth.verifyBackupCode).toHaveBeenCalledWith("abcd-efgh-ij"));
    expect(auth.verifyTwoFactor).not.toHaveBeenCalled();
  });

  // Sends, then switches, then verifies against the OTP endpoint — not the TOTP one.
  // Getting that wrong fails in a way indistinguishable from a wrong code.
  it("sends a mailed code and then verifies it against the OTP endpoint", async () => {
    const auth = authDouble();
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={vi.fn()} />, NONE);

    fireEvent.click(screen.getByRole("button", { name: "Email me a code instead" }));
    await waitFor(() => expect(auth.sendTwoFactorOtp).toHaveBeenCalled());

    typeCode("Authentication code", "654321");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(auth.verifyTwoFactorOtp).toHaveBeenCalledWith("654321"));
    expect(auth.verifyTwoFactor).not.toHaveBeenCalled();
  });
});

describe("TwoFactorForm — switching between them", () => {
  // Carrying a half-typed six-digit TOTP into the backup-code field submits something
  // guaranteed to fail, and burns one of the three attempts a minute the server allows.
  it("clears the code when the method changes", async () => {
    await renderWithFakes(<TwoFactorForm auth={authDouble()} onSuccess={vi.fn()} />, NONE);

    typeCode("Authentication code", "123");
    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));

    expect((screen.getByLabelText("Backup code") as HTMLInputElement).value).toBe("");
  });

  // Both alternatives stay reachable from wherever the user is, so there is no order to
  // get stuck in — the person using this screen is already having a bad day.
  it("offers a way back to the authenticator app", async () => {
    await renderWithFakes(<TwoFactorForm auth={authDouble()} onSuccess={vi.fn()} />, NONE);

    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Use your authenticator app instead" }));

    expect(screen.getByLabelText("Authentication code")).toBeDefined();
  });

  // The regression guard: a ternary on `totp` meant the emailed code offered only a way
  // back to the authenticator — the one method someone without their phone cannot use.
  it("offers backup codes from the emailed one-time code", async () => {
    const auth = authDouble();
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={vi.fn()} />, NONE);

    fireEvent.click(screen.getByRole("button", { name: "Email me a code instead" }));
    await waitFor(() => expect(auth.sendTwoFactorOtp).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    typeCode("Backup code", "abcd-efgh-ij");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(auth.verifyBackupCode).toHaveBeenCalledWith("abcd-efgh-ij"));
  });

  it("takes the sent-a-code notice away with the method it belongs to", async () => {
    const auth = authDouble();
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={vi.fn()} />, NONE);

    fireEvent.click(screen.getByRole("button", { name: "Email me a code instead" }));
    expect(await screen.findByText(/We sent a code/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Use your authenticator app instead" }));

    expect(screen.queryByText(/We sent a code/i)).toBeNull();
  });

  it("clears a failure when the method changes", async () => {
    const auth = authDouble({
      verifyTwoFactor: vi.fn().mockRejectedValue(new UnauthorizedError()),
    });
    await renderWithFakes(<TwoFactorForm auth={auth} onSuccess={vi.fn()} />, NONE);

    typeCode("Authentication code", "000000");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That code was not right.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));

    expect(screen.queryByText("That code was not right.")).toBeNull();
  });
});
