import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { FlagDto } from "@loadbearing/contracts";
import type { CapabilitySetDto, PermissionKey } from "@loadbearing/permissions";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlagList } from "../../src/platform/flag.list.js";
import { renderWithFakes } from "../support/render-with-fakes.js";

const DECLARED: FlagDto = {
  key: "example.rollout",
  owner: "sami",
  expiresOn: "2999-12-31",
  description: "Lets a user hide a card",
  isEnabled: false,
  targets: [
    {
      organizationId:
        "00000000-0000-7000-8000-0000000000a1" as FlagDto["targets"][number]["organizationId"],
      slug: "acme",
    },
  ],
  orphaned: false,
  updatedAt: null,
};

const ORPHAN: FlagDto = {
  key: "retired.flag",
  owner: null,
  expiresOn: null,
  description: null,
  isEnabled: true,
  targets: [],
  orphaned: true,
  updatedAt: null,
};

// The platform axis, which `capabilitiesWith` does not fill: every key here is platform.
const platform = (...grants: readonly PermissionKey[]): CapabilitySetDto => ({
  wildcard: false,
  org: { grants: [], denies: [] },
  goals: {},
  platform: { grants, denies: [] },
});

function fakeClient(items: readonly FlagDto[]) {
  const calls: { procedure: string; input: unknown }[] = [];
  const client = ApiClient.inProcess({
    platform: {
      listFlags: () => Promise.resolve({ items }),
      updateFlag: (input: unknown) => {
        calls.push({ procedure: "updateFlag", input });
        return Promise.resolve({ ok: true });
      },
      updateFlagTarget: (input: unknown) => {
        calls.push({ procedure: "updateFlagTarget", input });
        return Promise.resolve({ ok: true });
      },
    },
  } as unknown as AppClient);
  return { client, calls };
}

const renderList = (items: readonly FlagDto[], capabilities: CapabilitySetDto) => {
  const fake = fakeClient(items);
  return renderWithFakes(<FlagList />, capabilities, undefined, ["platform"], fake.client).then(
    () => fake,
  );
};

describe("FlagList", () => {
  it("shows owner and expiry from code, and the organizations from the database", async () => {
    await renderList([DECLARED], platform("platform.flag.read"));

    expect(await screen.findByText("example.rollout")).toBeTruthy();
    expect(screen.getByText("sami")).toBeTruthy();
    expect(screen.getByText("2999-12-31")).toBeTruthy();
    expect(screen.getByText("acme")).toBeTruthy();
  });

  it("marks a row the code no longer declares as orphaned", async () => {
    await renderList([ORPHAN], platform("platform.flag.read"));

    expect(await screen.findByText("Not declared in code")).toBeTruthy();
  });

  it("warns about a flag past its expiry, before the build fails on it", async () => {
    await renderList([{ ...DECLARED, expiresOn: "2000-01-01" }], platform("platform.flag.read"));

    expect(await screen.findByText("Past its expiry date — retire it")).toBeTruthy();
  });

  // Read is enough to see; the switches are an affordance for `platform.flag.manage`.
  it("offers no switch to a caller who may only read", async () => {
    await renderList([DECLARED], platform("platform.flag.read"));

    await screen.findByText("example.rollout");
    expect(screen.queryByRole("button", { name: "Turn on for everyone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn on for this organization" })).toBeNull();
  });

  it("switches a flag for everyone, and adds and removes an organization", async () => {
    const { calls } = await renderList(
      [DECLARED],
      platform("platform.flag.read", "platform.flag.manage"),
    );

    // One at a time: each button is disabled while its own write is in flight.
    fireEvent.click(await screen.findByRole("button", { name: "Turn on for everyone" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Turn off for acme" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Turn on for this organization" })
          .disabled,
      ).toBe(true),
    );
    fireEvent.change(screen.getByLabelText("Organization id or slug"), {
      target: { value: "globex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn on for this organization" }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls).toEqual([
      { procedure: "updateFlag", input: { key: "example.rollout", enabled: true } },
      {
        procedure: "updateFlagTarget",
        input: {
          key: "example.rollout",
          organization: "00000000-0000-7000-8000-0000000000a1",
          enabled: false,
        },
      },
      {
        procedure: "updateFlagTarget",
        input: { key: "example.rollout", organization: "globex", enabled: true },
      },
    ]);
  });

  // On would switch something no code reads, so an orphan offers only "off".
  it("offers an orphan that is on the switch that turns it off", async () => {
    await renderList([ORPHAN], platform("platform.flag.read", "platform.flag.manage"));

    expect(await screen.findByRole("button", { name: "Turn off for everyone" })).toBeTruthy();
  });

  it("offers an orphan that is off no switch at all", async () => {
    await renderList([{ ...ORPHAN, isEnabled: false }], platform("platform.flag.manage"));

    await screen.findByText("Not declared in code");
    expect(screen.queryByRole("button", { name: "Turn on for everyone" })).toBeNull();
  });
});
