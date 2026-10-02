import type { CapabilitySetDto } from "@loadbearing/permissions";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../../src/auth/session.context.js";
import { PlatformNav } from "../../src/platform/platform-nav.js";
import { renderWithFakes, TEST_ORGANIZATION, TEST_USER } from "../support/render-with-fakes.js";

const PLATFORM_ORG = {
  id: "00000000-0000-7000-8000-0000000000a2",
  name: "Loadbearing",
  roleName: "Platform administrator",
  isPlatform: true,
};

const staff = (grants: readonly string[], platform: readonly string[]): CapabilitySetDto =>
  ({
    wildcard: false,
    org: { grants: [...grants], denies: [] },
    platform: { grants: [...platform], denies: [] },
    goals: {},
  }) as CapabilitySetDto;

const mount = async (
  capabilities: CapabilitySetDto,
  inPlatform: boolean,
  user: SessionUser = { ...TEST_USER, organizations: [TEST_ORGANIZATION, PLATFORM_ORG] },
) => {
  const onOpenPlatform = vi.fn();
  await renderWithFakes(
    <PlatformNav
      renderLink={(href, label) => <a href={href}>{label}</a>}
      onOpenPlatform={onOpenPlatform}
    />,
    capabilities,
    user,
    ["platform"],
    undefined,
    [],
    inPlatform,
  );
  return onOpenPlatform;
};

const links = () => screen.getAllByRole("link").map((link) => link.textContent);

describe("PlatformNav", () => {
  it("shows each platform page only to a holder of its key", async () => {
    await mount(staff([], ["platform.account.read", "platform.flag.read"]), true);
    expect(links()).toEqual(["Accounts", "Feature flags"]);
  });

  // The team, roles and docs act on the active organization, so only inside the platform one.
  it("adds the team, roles and docs inside the platform organization", async () => {
    await mount(
      staff(["member.read", "rbac.role.read", "doc.page.write"], ["platform.status.read"]),
      true,
    );
    expect(links()).toEqual(["Status", "Team", "Roles", "Docs"]);
    expect(screen.queryByRole("button", { name: "Open the platform organization" })).toBeNull();
  });

  it("offers to open the platform organization from any other", async () => {
    const open = await mount(
      staff(["member.read", "rbac.role.read"], ["platform.status.read"]),
      false,
    );
    expect(links()).toEqual(["Status"]);

    fireEvent.click(screen.getByRole("button", { name: "Open the platform organization" }));
    expect(open).toHaveBeenCalledWith(PLATFORM_ORG.id);
  });
});
