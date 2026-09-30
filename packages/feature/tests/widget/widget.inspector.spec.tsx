import type { ApiClient } from "@loadbearing/api-client";
import type { FlagKey } from "@loadbearing/permissions";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WidgetInspector } from "../../src/widget/widget.inspector.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const MEMBER = "00000000-0000-7000-8000-000000000002";

function fakeClient(
  preferences = { hiddenByAdmin: [] as string[], hiddenByUser: [] as string[] },
  theirGrants: readonly string[] = [],
) {
  const preferencesOf = vi.fn().mockResolvedValue(preferences);
  const effective = vi.fn().mockResolvedValue({
    capabilities: { wildcard: false, org: { grants: [...theirGrants], denies: [] }, goals: {} },
    explanation: { roleGrants: [], goalGrants: {}, overrides: [], entitled: [] },
  });
  const client = {
    widget: { preferences: vi.fn().mockResolvedValue(preferences), preferencesOf },
    role: { effective },
  } as unknown as ApiClient;
  return { client, preferencesOf, effective };
}

const render = (
  grants: readonly string[],
  client: ApiClient,
  flags: readonly FlagKey[] = [],
  userId?: string,
) =>
  renderWithFakes(
    <WidgetInspector {...(userId ? { userId } : {})} />,
    capabilitiesWith(grants),
    undefined,
    ["widget"],
    client,
    flags,
  );

// The row a card sits in, as one string: the title, the one-word answer and the reason.
const rowOf = async (label: string) =>
  (await screen.findByText(label)).closest("tr")?.textContent ?? "";

describe("WidgetInspector", () => {
  // The exit's own sentence: a member missing the member card is told which key it needs.
  it("names the missing key for a denied card, and says a flagged one is not on yet", async () => {
    await render([], fakeClient().client);

    expect(await rowOf("Members")).toContain("denied — member.read");
    expect(await rowOf("Go to")).toContain("visible");
    expect(await rowOf("Hidden cards")).toContain("hidden-by-flag");
    expect(await rowOf("Notifications")).toContain("denied — notification.inbox.read");
  });

  it("says who hid a card, and shows a stored row for a card that no longer exists", async () => {
    await render(
      ["member.read"],
      fakeClient({ hiddenByAdmin: ["member.count"], hiddenByUser: ["retired.card"] }).client,
      ["widget.dismissal"],
    );

    expect(await rowOf("Members")).toContain("hidden-by-admin");
    expect(await rowOf("retired.card")).toContain("unregistered");
  });

  it("says a card was hidden by choice", async () => {
    await render(
      ["member.read"],
      fakeClient({ hiddenByAdmin: [], hiddenByUser: ["member.count"] }).client,
      ["widget.dismissal"],
    );

    expect(await rowOf("Members")).toContain("hidden-by-user");
  });

  // Another member's answer is theirs: their resolved keys and their rows, not the viewer's.
  it("answers for another member from their capabilities and their preferences", async () => {
    const { client, preferencesOf, effective } = fakeClient(
      { hiddenByAdmin: [], hiddenByUser: [] },
      [],
    );
    await render(["member.read", "rbac.effective.inspect"], client, ["widget.dismissal"], MEMBER);

    expect(await rowOf("Members")).toContain("denied — member.read");
    expect(effective).toHaveBeenCalledWith({ userId: MEMBER });
    expect(preferencesOf).toHaveBeenCalledWith({ userId: MEMBER });
  });
});
