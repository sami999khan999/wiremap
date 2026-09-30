import type { ApiClient } from "@loadbearing/api-client";
import { type FlagKey, WidgetRegistry } from "@loadbearing/permissions";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardZone, prefetchDashboard } from "../../src/dashboard/dashboard-zone.js";
import { CapabilitySet } from "../../src/import.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeClient(
  preferences: { hiddenByAdmin: string[]; hiddenByUser: string[] } = {
    hiddenByAdmin: [],
    hiddenByUser: [],
  },
) {
  const list = vi.fn().mockResolvedValue({ items: [], total: 4 });
  const read = vi.fn().mockResolvedValue(preferences);
  const update = vi.fn().mockResolvedValue({ ok: true });
  const client = {
    member: { list },
    widget: { preferences: read, updatePreference: update },
  } as unknown as ApiClient;
  return { client, list, read, update };
}

const renderZone = (grants: readonly string[], client: ApiClient, flags: readonly FlagKey[] = []) =>
  renderWithFakes(
    <DashboardZone
      nav={[]}
      renderLink={(route, label) => (
        <a key={route} href={route}>
          {label}
        </a>
      )}
    />,
    capabilitiesWith(grants),
    undefined,
    ["nav", "widget"],
    client,
    flags,
  );

describe("DashboardZone", () => {
  it("renders a card for every visible widget, titled from the registry's copy", async () => {
    const { client, list } = fakeClient();
    await renderZone(["member.read"], client);

    expect(screen.getByRole("region", { name: "Dashboard" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Go to" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Members" })).toBeDefined();
    await waitFor(() => expect(screen.getByText("Members: 4")).toBeDefined());
    expect(list).toHaveBeenCalledTimes(1);
  });

  // The point of the zone: a denied card is not rendered hidden, it is never mounted, so its
  // query is never issued.
  it("never mounts a denied widget, and never calls what it would have read", async () => {
    const { client, list } = fakeClient();
    await renderZone([], client);

    expect(screen.getByRole("heading", { name: "Go to" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("never mounts a flag-hidden widget either", async () => {
    const real = WidgetRegistry.instance.visibilityOf.bind(WidgetRegistry.instance);
    vi.spyOn(WidgetRegistry.instance, "visibilityOf").mockImplementation((key, facts) =>
      key === "member.count" ? "hidden-by-flag" : real(key, facts),
    );
    const { client, list } = fakeClient();
    await renderZone(["member.read"], client);

    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("prefetchDashboard", () => {
  it("prefetches for a visible widget, and skips a denied one", async () => {
    const allowed = fakeClient();
    await prefetchDashboard(
      new QueryClient(),
      allowed.client,
      CapabilitySet.from(capabilitiesWith(["member.read"])),
      [],
    );
    expect(allowed.list).toHaveBeenCalledTimes(1);

    const denied = fakeClient();
    await prefetchDashboard(
      new QueryClient(),
      denied.client,
      CapabilitySet.from(capabilitiesWith([])),
      [],
    );
    expect(denied.list).not.toHaveBeenCalled();
  });

  it("skips a flag-hidden widget", async () => {
    vi.spyOn(WidgetRegistry.instance, "visibilityOf").mockReturnValue("hidden-by-flag");
    const { client, list } = fakeClient();

    await prefetchDashboard(
      new QueryClient(),
      client,
      CapabilitySet.from(capabilitiesWith(["member.read"])),
      [],
    );

    expect(list).not.toHaveBeenCalled();
  });

  // A runtime backstop to the `satisfies`: the zone and the map agree on every key.
  it("has a card for exactly the widgets the registry puts in the zone", async () => {
    const { client } = fakeClient();
    await renderZone(["member.read"], client, ["widget.dismissal"]);
    await screen.findByRole("heading", { name: "Hidden cards" });

    const titles = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(titles).toHaveLength(WidgetRegistry.instance.forZone("dashboard.main").length);
  });
});

// `AX9.8`. The rollout: preferences apply only while `widget.dismissal` is on for the org.
describe("DashboardZone with widget.dismissal", () => {
  const ON: readonly FlagKey[] = ["widget.dismissal"];

  it("never mounts a card the user hid, and never calls what it would have read", async () => {
    const { client, list } = fakeClient({ hiddenByAdmin: [], hiddenByUser: ["member.count"] });
    await renderZone(["member.read"], client, ON);

    await screen.findByRole("heading", { name: "Hidden cards" });
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show Members again" })).toBeDefined();
  });

  it("locks a card the admin hid for everyone in the tray", async () => {
    const { client } = fakeClient({ hiddenByAdmin: ["member.count"], hiddenByUser: [] });
    await renderZone(["member.read"], client, ON);

    expect(await screen.findByText("Hidden for everyone by your organization")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Show Members again" })).toBeNull();
  });

  it("hides a dismissible card through the procedure, and offers nothing on a required one", async () => {
    const { client, update } = fakeClient();
    await renderZone(["member.read"], client, ON);

    fireEvent.click(await screen.findByRole("button", { name: "Hide Members" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ widget: "member.count", hidden: true }),
    );
    expect(screen.queryByRole("button", { name: "Hide Go to" })).toBeNull();
  });

  // Off, the dashboard is the one it was before the table existed: no request, no tray, no
  // Hide action, and a stored row hides nothing.
  it("reads no preference and offers no Hide action where the flag is off", async () => {
    const { client, read } = fakeClient({ hiddenByAdmin: [], hiddenByUser: ["member.count"] });
    await renderZone(["member.read"], client);

    expect(screen.getByRole("heading", { name: "Members" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Hidden cards" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide Members" })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("prefetches nothing for a card the user hid", async () => {
    const { client, list } = fakeClient({ hiddenByAdmin: [], hiddenByUser: ["member.count"] });

    await prefetchDashboard(
      new QueryClient(),
      client,
      CapabilitySet.from(capabilitiesWith(["member.read"])),
      ON,
    );

    expect(list).not.toHaveBeenCalled();
  });
});
