import type { OrganizationClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../../src/auth/session.context.js";
import { InvitationAccept } from "../../src/organization/invitation-accept.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const PREVIEW = { organizationName: "Acme", email: TEST_USER.email, expired: false };

const clientWith = (acceptInvitation = vi.fn()) =>
  ({ acceptInvitation }) as unknown as OrganizationClient;

const render = (
  props: Partial<Parameters<typeof InvitationAccept>[0]>,
  user: SessionUser | null = TEST_USER,
) =>
  renderWithFakes(
    <InvitationAccept
      preview={PREVIEW}
      token="tok"
      organization={clientWith()}
      onAccepted={vi.fn()}
      onSignIn={vi.fn()}
      onSignUp={vi.fn()}
      {...props}
    />,
    capabilitiesWith([]),
    user,
    ["organization"],
  );

// The four states in the order the component decides them: each earlier one makes the
// later question moot, so only the last renders a button.
describe("InvitationAccept", () => {
  it("says the invitation is gone when there is no preview", async () => {
    await render({ preview: null });

    expect(screen.getByText(/no longer valid/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says the invitation has expired", async () => {
    await render({ preview: { ...PREVIEW, expired: true } });

    expect(screen.getByText(/has expired/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers sign-up and sign-in to a visitor, and calls back rather than navigating", async () => {
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();
    await render({ onSignIn, onSignUp }, null);

    fireEvent.click(screen.getByText(/Sign in as/));
    fireEvent.click(screen.getByText(/Create an account/));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).toHaveBeenCalledOnce();
  });

  it("refuses the wrong signed-in address without offering a button", async () => {
    await render({ preview: { ...PREVIEW, email: "someone-else@example.test" } });

    expect(screen.getByText(/signed in as ada@example.test/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("accepts with the token for the invited person", async () => {
    const acceptInvitation = vi.fn().mockResolvedValue({ organizationId: "x" });
    await render({ organization: clientWith(acceptInvitation) });

    fireEvent.click(screen.getByText(/Join Acme/));

    // The mutation runs on a microtask after the click, so the call is awaited.
    await waitFor(() => expect(acceptInvitation).toHaveBeenCalledWith("tok"));
  });
});
