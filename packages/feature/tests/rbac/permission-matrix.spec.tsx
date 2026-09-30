import { CapabilitySet, PermissionRegistry } from "@loadbearing/permissions";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PermissionMatrix } from "../../src/rbac/permission-matrix.js";
import {
  CORE_KEYS,
  capabilitiesWith,
  GRANTABLE,
  renderWithFakes,
  TEST_USER,
} from "../support/render-with-fakes.js";

const ALL = PermissionRegistry.instance.all();
const FIRST = GRANTABLE[0];

describe("PermissionMatrix", () => {
  // The same component, two capability fixtures, a different answer — which exercises the
  // DTO round-trip, the session context and `CapabilitySet.can` at once.
  it("answers differently for two different capability sets", async () => {
    if (!FIRST) throw new Error("the permission catalog is empty");

    await renderWithFakes(
      <PermissionMatrix
        subjects={[
          {
            id: "granted",
            label: "Granted",
            capabilities: CapabilitySet.from(capabilitiesWith([FIRST])),
          },
          { id: "denied", label: "Denied", capabilities: CapabilitySet.from(capabilitiesWith([])) },
        ]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    // One cell for the grant, plus both subjects' `core.*` rows: every principal holds
    // those, which is exactly what the matrix should show.
    expect(screen.getAllByText("Allowed")).toHaveLength(1 + CORE_KEYS.length * 2);
    expect(screen.getAllByText("Denied").length).toBeGreaterThan(1);
  });

  it("renders one row per catalog permission", async () => {
    await renderWithFakes(
      <PermissionMatrix
        subjects={[{ id: "a", label: "A", capabilities: CapabilitySet.empty() }]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    // Header row plus one per permission. The rows are the catalog, not data.
    expect(screen.getAllByRole("row")).toHaveLength(ALL.length + 1);
  });

  it("names every column, so a cell is announced with its subject", async () => {
    await renderWithFakes(
      <PermissionMatrix
        subjects={[{ id: "a", label: "Admin", capabilities: CapabilitySet.empty() }]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    expect(screen.getByRole("columnheader", { name: "Admin" })).toBeDefined();
  });

  it("falls back to the empty state with no subjects", async () => {
    await renderWithFakes(<PermissionMatrix subjects={[]} />, capabilitiesWith([]), TEST_USER, [
      "role",
    ]);

    expect(screen.getByText("Nothing here yet")).toBeDefined();
  });

  // The regression: the column of permission names had an empty `<th>`, announced as
  // blank — so a screen reader reached every row header through a column with no name.
  it("names the column its row headers sit in", async () => {
    await renderWithFakes(
      <PermissionMatrix
        subjects={[{ id: "a", label: "Admin", capabilities: CapabilitySet.empty() }]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    expect(screen.getByRole("columnheader", { name: "Permission" })).toBeDefined();
  });
});

// `18.11`: the checkbox a tenant owner would have ticked to get a 403. The grant
// use-case refuses it either way; this is the affordance, not the enforcement.
describe("PermissionMatrix — excludeScopes", () => {
  const PLATFORM_KEYS = PermissionRegistry.instance.byScope("platform");

  it("drops every row of an excluded scope and keeps the rest", async () => {
    await renderWithFakes(
      <PermissionMatrix
        subjects={[{ id: "a", label: "A", capabilities: CapabilitySet.empty() }]}
        excludeScopes={["platform"]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    expect(PLATFORM_KEYS.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row")).toHaveLength(ALL.length - PLATFORM_KEYS.length + 1);

    for (const key of PLATFORM_KEYS) expect(screen.queryByText(key)).toBeNull();
  });

  it("keeps every row when no scope is excluded", async () => {
    await renderWithFakes(
      <PermissionMatrix
        subjects={[{ id: "a", label: "A", capabilities: CapabilitySet.empty() }]}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

    const first = PLATFORM_KEYS[0];
    if (!first) throw new Error("no platform key is registered");
    expect(screen.getByText(first)).toBeDefined();
  });
});

// `AX4.8`. A key outside the org's plan is shown, because the grant is still stored, but
// cannot be edited. The row says why, once, rather than in every column.
describe("PermissionMatrix — keys outside the plan", () => {
  const editable = (blocked?: ReadonlySet<(typeof ALL)[number]>) =>
    renderWithFakes(
      <PermissionMatrix
        subjects={[
          {
            id: "member",
            label: "Member",
            editable: true,
            capabilities: CapabilitySet.from(capabilitiesWith(["apikey.read"])),
          },
        ]}
        onToggle={() => undefined}
        {...(blocked ? { blocked } : {})}
      />,
      capabilitiesWith([]),
      TEST_USER,
      ["role"],
    );

  it("disables a blocked key's checkbox and says it is not in the plan", async () => {
    await editable(new Set(["apikey.read"]));

    const box = screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Member — apikey.read",
    });
    expect(box.disabled).toBe(true);
    // Still ticked: the grant is kept, which is what makes an upgrade restore it.
    expect(box.checked).toBe(true);
    expect(screen.getAllByText("Not included in your plan")).toHaveLength(1);
  });

  it("leaves every row editable when nothing is blocked", async () => {
    await editable();

    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Member — apikey.read" }).disabled,
    ).toBe(false);
    expect(screen.queryByText("Not included in your plan")).toBeNull();
  });
});
