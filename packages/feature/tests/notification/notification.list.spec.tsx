import type { ApiClient } from "@loadbearing/api-client";
import type { NotificationDto } from "@loadbearing/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationList } from "../../src/notification/notification.list.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const ROW: NotificationDto = {
  id: "00000000-0000-7000-8000-000000000001" as NotificationDto["id"],
  kind: "member.role.changed",
  category: "membership",
  params: {},
  link: "/settings/members",
  readAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
};

const clientWith = (list: () => Promise<unknown>) =>
  ({
    notification: { list, unreadCount: () => Promise.resolve({ count: 0 }) },
  }) as unknown as ApiClient;

const render = (list: () => Promise<unknown>) =>
  renderWithFakes(
    <NotificationList />,
    capabilitiesWith([]),
    undefined,
    ["notification"],
    clientWith(list),
  );

describe("NotificationList", () => {
  it("shows a skeleton rather than a list it does not have", async () => {
    const { container } = await render(() => new Promise(() => undefined));

    expect(container.querySelector(".ui-data-table__skeleton-cell")).not.toBeNull();
  });

  // The same regression the member list carries a guard for: a failed load must not
  // fall through to the empty state and claim there is nothing to see.
  it("says something went wrong rather than saying there is nothing", async () => {
    await render(() => Promise.reject(new Error("nope")));

    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined(),
    );
    expect(screen.queryByText("Nothing yet. This is where updates will appear.")).toBeNull();
  });

  it("shows the empty state when the inbox really is empty", async () => {
    await render(() => Promise.resolve({ items: [], nextCursor: null }));

    await waitFor(() =>
      expect(screen.getByText("Nothing yet. This is where updates will appear.")).toBeDefined(),
    );
  });

  // The row carries no snapshot of what happened, so the copy has to stand on its own —
  // this is what says the `kind` reaches a translated title rather than rendering raw.
  it("renders each row's copy from its kind", async () => {
    await render(() => Promise.resolve({ items: [ROW], nextCursor: null }));

    await waitFor(() => expect(screen.getByText("Your role changed")).toBeDefined());
  });

  // A permanently greyed "load more" reads as something broken rather than as a list
  // that has finished, so it is absent on the last page.
  it("offers no load-more on the last page", async () => {
    await render(() => Promise.resolve({ items: [ROW], nextCursor: null }));

    await waitFor(() => expect(screen.getByText("Your role changed")).toBeDefined());
    expect(screen.queryByText("Load older")).toBeNull();
  });

  it("offers load-more when the page reports a cursor", async () => {
    await render(() => Promise.resolve({ items: [ROW], nextCursor: "abc" }));

    await waitFor(() => expect(screen.getByText("Load older")).toBeDefined());
  });
  // The trap: with the filter on and nothing unread, the empty state replaced the whole
  // tree and took the toggle with it, so there was no way back short of a reload.
  it("keeps the unread-only toggle beside the empty state", async () => {
    await render(() => Promise.resolve({ items: [], nextCursor: null }));

    await waitFor(() =>
      expect(screen.getByText("Nothing yet. This is where updates will appear.")).toBeDefined(),
    );

    expect(screen.getByText("Unread only")).toBeDefined();
    fireEvent.click(screen.getByText("Unread only"));
    expect(screen.getByText("Unread only")).toBeDefined();
  });
});
