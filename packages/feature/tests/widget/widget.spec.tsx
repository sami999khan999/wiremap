import { WidgetRegistry } from "@loadbearing/permissions";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Widget } from "../../src/widget/widget.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Widget", () => {
  // The permission is the registry's: `notification.bell` names `notification.inbox.read`.
  it("renders its children bare for someone who holds the registry's permission", async () => {
    const { container } = await renderWithFakes(
      <Widget widget="notification.bell">
        <span>bell</span>
      </Widget>,
      capabilitiesWith(["notification.inbox.read"]),
    );

    expect(screen.getByText("bell")).toBeDefined();
    expect(container.innerHTML).toBe("<span>bell</span>");
  });

  it("renders the fallback, or nothing, for someone who does not", async () => {
    const { container } = await renderWithFakes(
      <Widget widget="notification.bell">
        <span>bell</span>
      </Widget>,
      capabilitiesWith([]),
    );
    expect(container.innerHTML).toBe("");

    await renderWithFakes(
      <Widget widget="notification.bell" fallback={<span>none</span>}>
        <span>bell</span>
      </Widget>,
      capabilitiesWith([]),
    );
    expect(screen.getByText("none")).toBeDefined();
  });

  // No inline widget names a flag yet, so the registry's answer is forced: what is under test
  // is that anything other than `visible` keeps the children out.
  it("hides on any answer but visible, a flag included", async () => {
    vi.spyOn(WidgetRegistry.instance, "visibilityOf").mockReturnValue("hidden-by-flag");

    const { container } = await renderWithFakes(
      <Widget widget="notification.bell">
        <span>bell</span>
      </Widget>,
      capabilitiesWith(["notification.inbox.read"]),
    );

    expect(container.innerHTML).toBe("");
  });

  it("passes the goal to the permission check", async () => {
    const spy = vi.spyOn(WidgetRegistry.instance, "visibilityOf");

    await renderWithFakes(
      <Widget widget="notification.bell" goalId="goal-1">
        <span>bell</span>
      </Widget>,
      capabilitiesWith([]),
    );

    expect(spy).toHaveBeenCalledWith(
      "notification.bell",
      expect.objectContaining({ goalId: "goal-1" }),
    );
  });
});
