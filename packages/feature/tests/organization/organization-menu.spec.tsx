import type { OrganizationClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationMenu } from "../../src/organization/organization-menu.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const SECOND = { id: "00000000-0000-7000-8000-0000000000a2", name: "Beta", roleName: "Member" };
const user = { ...TEST_USER, organizations: [...TEST_USER.organizations, SECOND] };

const render = async (switchTo: () => Promise<unknown> = vi.fn()) => {
  const props = { onSwitched: vi.fn(), onCreate: vi.fn(), onSettings: vi.fn() };
  await renderWithFakes(
    <OrganizationMenu
      organization={{ switch: switchTo } as unknown as OrganizationClient}
      {...props}
    />,
    capabilitiesWith([]),
    user,
    ["nav"],
  );
  return props;
};

describe("OrganizationMenu", () => {
  it("shows the active organization and lists every membership when opened", async () => {
    await render();

    const trigger = screen.getByRole("button", { name: "Switch organization" });
    expect(trigger.textContent).toContain("Acme");

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /Beta/ })).toBeTruthy());
    expect(screen.getByRole("menuitem", { name: /Organization settings/ })).toBeTruthy();
  });

  it("switches to another organization, and does nothing for the active one", async () => {
    const switchTo = vi.fn().mockResolvedValue({});
    await render(switchTo);

    fireEvent.click(screen.getByRole("button", { name: "Switch organization" }));
    await waitFor(() => screen.getByRole("menuitem", { name: /Acme/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Acme/ }));
    expect(switchTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch organization" }));
    await waitFor(() => screen.getByRole("menuitem", { name: /Beta/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Beta/ }));
    await waitFor(() => expect(switchTo).toHaveBeenCalled());
  });
});
