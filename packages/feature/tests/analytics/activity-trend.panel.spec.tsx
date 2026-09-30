import { ApiClient, type AppClient } from "@loadbearing/api-client";
import type { ActivityDto } from "@loadbearing/contracts";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityTrendPanel } from "../../src/analytics/activity-trend.panel.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const ACTIVITY: ActivityDto = {
  configured: true,
  from: "2026-08-27",
  to: "2026-09-26",
  points: [
    { day: "2026-09-24", action: "member.joined", count: 2 },
    { day: "2026-09-25", action: "member.joined", count: 1 },
    { day: "2026-09-25", action: "role.created", count: 4 },
  ],
};

// Records what it was asked for, because the period switch is only visible as a
// different `days` reaching the procedure.
const fakeClient = (answer: ActivityDto, asked: number[] = []) =>
  ApiClient.inProcess({
    analytics: {
      activity: (input: { days: number }) => {
        asked.push(input.days);
        return Promise.resolve(answer);
      },
    },
  } as unknown as AppClient);

const renderPanel = (answer: ActivityDto, asked?: number[]) =>
  renderWithFakes(
    <ActivityTrendPanel />,
    capabilitiesWith(["analytics.activity.read"]),
    undefined,
    ["analytics"],
    fakeClient(answer, asked),
  );

describe("ActivityTrendPanel", () => {
  it("totals by day, newest first, and by action, largest first", async () => {
    await renderPanel(ACTIVITY);

    expect(await screen.findByText(/Events: 7/)).toBeTruthy();
    // The last day the window contains, not `to`, which is exclusive.
    expect(screen.getByText(/2026-08-27 to 2026-09-25/)).toBeTruthy();

    const [byDay, byAction] = screen.getAllByRole("table");
    if (!byDay || !byAction) throw new Error("two tables expected");
    const days = within(byDay)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
    expect(days).toEqual(["2026-09-255", "2026-09-242"]);

    const actions = within(byAction)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
    expect(actions).toEqual(["role.created4", "member.joined3"]);
  });

  it("asks for ninety days when the period is switched", async () => {
    const asked: number[] = [];
    await renderPanel(ACTIVITY, asked);

    fireEvent.click(await screen.findByRole("button", { name: "Last 90 days" }));

    await screen.findByRole("button", { name: "Last 90 days", pressed: true });
    expect(asked).toEqual([30, 90]);
  });

  // The third state: no store is not an empty tenant, and must not render as one.
  it("says analytics are not configured rather than showing an empty dashboard", async () => {
    await renderPanel({ ...ACTIVITY, configured: false, points: [] });

    expect(
      await screen.findByText("Analytics are not configured on this deployment."),
    ).toBeTruthy();
    expect(screen.queryByText("Nothing happened in this period.")).toBeNull();
  });

  it("says nothing happened when the store has no rows for the period", async () => {
    await renderPanel({ ...ACTIVITY, points: [] });

    expect(await screen.findByText("Nothing happened in this period.")).toBeTruthy();
    expect(screen.queryAllByRole("table")).toEqual([]);
  });
});
