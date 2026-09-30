import type { ApiClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationBell } from "../../src/notification/notification-bell.button.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const UNREAD = {
  id: "018f8c00-0000-7000-8000-0000000000f1",
  kind: "member.joined",
  category: "membership",
  params: {},
  link: null,
  readAt: null,
  createdAt: new Date("2026-09-14T10:00:00.000Z"),
};

interface Calls {
  list: number;
}

const clientWith = (count: number, calls: Calls) =>
  ({
    notification: {
      unreadCount: () => Promise.resolve({ count }),
      list: () => {
        calls.list += 1;
        return Promise.resolve({ items: count > 0 ? [UNREAD] : [], nextCursor: null });
      },
      markRead: () => Promise.resolve({ ok: true }),
    },
  }) as unknown as ApiClient;

const render = (count: number, calls: Calls = { list: 0 }) =>
  renderWithFakes(
    <NotificationBell href="/notifications" />,
    capabilitiesWith([]),
    undefined,
    ["notification"],
    clientWith(count, calls),
  );

const bell = () => screen.getByRole("button", { name: "Open notifications" });

describe("NotificationBell", () => {
  // A "0" reads as a number worth looking at. An empty bell is the quiet state.
  it("shows no badge when nothing is unread", async () => {
    const { container } = await render(0);

    await waitFor(() => expect(bell()).toBeDefined());
    expect(container.querySelector(".ui-status-badge")).toBeNull();
  });

  it("shows the count when something is unread", async () => {
    await render(3);

    await waitFor(() => expect(screen.getByText("3")).toBeDefined());
  });

  // The repository caps at 100, so the count comes back as exactly 100 and the badge is
  // what turns that into an honest "99+" rather than a number that is quietly wrong.
  it("renders the cap as 99+", async () => {
    await render(100);

    await waitFor(() => expect(screen.getByText("99+")).toBeDefined());
  });

  // **The whole point of the popover.** A bell on every page that also read the list on
  // every page would be a request per navigation for a panel nobody opened.
  it("reads no notifications until it is opened", async () => {
    const calls = { list: 0 };
    await render(1, calls);

    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    expect(calls.list).toBe(0);

    fireEvent.click(bell());

    await waitFor(() => expect(calls.list).toBe(1));
  });

  it("opens the peek, with a way to the inbox", async () => {
    await render(1);

    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    fireEvent.click(bell());

    expect(await screen.findByRole("dialog", { name: "Open notifications" })).toBeDefined();
    const seeAll = await screen.findByText("See all notifications");
    expect(seeAll.getAttribute("href")).toBe("/notifications");
  });

  // Unread only, which is what makes it a peek rather than a second inbox in a box.
  it("says so when there is nothing unread", async () => {
    await render(0);

    await waitFor(() => expect(bell()).toBeDefined());
    fireEvent.click(bell());

    expect(await screen.findByText("Nothing unread. Everything here has been seen.")).toBeDefined();
  });
});
