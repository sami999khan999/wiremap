import type { OrganizationClient } from "@loadbearing/api-client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationSwitcher } from "../../src/organization/organization-switcher.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const clientThat = (switchTo: () => Promise<unknown>) =>
  ({ switch: switchTo }) as unknown as OrganizationClient;

const SECOND = { id: "00000000-0000-7000-8000-0000000000a2", name: "Beta", roleName: "Member" };

const user = {
  ...TEST_USER,
  organizations: [...TEST_USER.organizations, SECOND],
};

const render = async (switchTo: () => Promise<unknown>, over = user) => {
  const onSwitched = vi.fn();
  const onCreate = vi.fn();

  await renderWithFakes(
    <OrganizationSwitcher
      organization={clientThat(switchTo)}
      onSwitched={onSwitched}
      onCreate={onCreate}
    />,
    capabilitiesWith([]),
    over,
    ["nav"],
  );

  return { onSwitched, onCreate };
};

const select = () => screen.getByRole("combobox", { name: /^Organization/ });

// Opens the list and presses an option, the way a pointer does: Base UI selects on the
// click that ends the press, a tick after the list has opened.
const pick = async (name: string) => {
  fireEvent.click(select());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const option = screen.getByRole("option", { name });
  for (const type of ["pointerDown", "mouseDown", "pointerUp", "mouseUp", "click"] as const) {
    fireEvent[type](option);
  }
};

describe("OrganizationSwitcher", () => {
  // Off the session snapshot rather than a query: `fetchSession` already carries every
  // membership, so the switcher is right on the first painted byte.
  it("lists every membership and selects the active one", async () => {
    await render(vi.fn());

    expect(select().getAttribute("aria-label")).toBe("Organization: Acme");
    fireEvent.click(select());
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Acme",
        "Beta",
      ]),
    );
  });

  it("switches to the tenant that was picked and calls back once it lands", async () => {
    const switchTo = vi.fn().mockResolvedValue({ organizationId: SECOND.id });
    const { onSwitched } = await render(switchTo);

    await pick("Beta");

    await waitFor(() => {
      expect(switchTo).toHaveBeenCalledWith(SECOND.id);
      expect(onSwitched).toHaveBeenCalledTimes(1);
    });
  });

  // `disabled` alone removes the control from the tab order and says nothing about why,
  // which is why `aria-busy` rides with it.
  it("marks itself busy while the switch is in flight, not only disabled", async () => {
    let release = (_: unknown) => {};
    const switchTo = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { onSwitched } = await render(switchTo);

    await pick("Beta");

    await waitFor(() => {
      expect(select().hasAttribute("data-disabled")).toBe(true);
    });
    expect(select().getAttribute("aria-busy")).toBe("true");
    expect(onSwitched).not.toHaveBeenCalled();

    release({ organizationId: SECOND.id });
    await waitFor(() => {
      expect(onSwitched).toHaveBeenCalledTimes(1);
    });
  });

  it("offers the way to found a new one, and only calls back", async () => {
    const { onCreate } = await render(vi.fn());

    fireEvent.click(screen.getByRole("button", { name: "New organization" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  // Nothing to switch between, and no session to read the active tenant from.
  it("renders nothing at all for a visitor", async () => {
    await renderWithFakes(
      <OrganizationSwitcher
        organization={clientThat(vi.fn())}
        onSwitched={vi.fn()}
        onCreate={vi.fn()}
      />,
      capabilitiesWith([]),
      null,
      ["nav"],
    );

    expect(screen.queryByLabelText("Organization")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
