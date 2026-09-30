import type { AccountClient, ActiveSession } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveSessionList } from "../../src/account/active-session.list.js";
import { capabilitiesWith, renderWithFakes, TEST_USER } from "../support/render-with-fakes.js";

const session = (id: string, current: boolean): ActiveSession => ({
  id,
  token: `token-${id}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  userAgent: `agent-${id}`,
  ipAddress: null,
  current,
});

const clientWith = (
  listSessions: () => Promise<readonly ActiveSession[]>,
  revokeSession: () => Promise<void> = () => Promise.resolve(),
) =>
  ({
    listSessions,
    revokeSession: vi.fn(revokeSession),
    revokeOtherSessions: vi.fn(),
  }) as unknown as AccountClient;

const render = (
  listSessions: () => Promise<readonly ActiveSession[]>,
  revokeSession?: () => Promise<void>,
) =>
  renderWithFakes(
    <ActiveSessionList account={clientWith(listSessions, revokeSession)} />,
    capabilitiesWith([]),
    TEST_USER,
    ["account"],
  );

const revoke = (agent: string) => {
  const button = screen.getByText(agent).closest("li")?.querySelector("button");
  if (!button) throw new Error(`no revoke control beside ${agent}`);
  fireEvent.click(button);
};

describe("ActiveSessionList", () => {
  it("says it is loading rather than showing a list it does not have", async () => {
    await render(() => new Promise(() => undefined));

    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("says something went wrong rather than showing no sessions", async () => {
    await render(() => Promise.reject(new Error("nope")));

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByText("Something went wrong. Please try again.")).toBeDefined();
  });

  // The regression guard: the badge was rendered once, after the list, attached to no
  // row — so it named no device at all.
  it("marks the current session on its own row", async () => {
    await render(() => Promise.resolve([session("a", false), session("b", true)]));

    await waitFor(() => expect(screen.getByText("agent-b")).toBeDefined());

    const current = screen.getByText("agent-b").closest("li");
    const other = screen.getByText("agent-a").closest("li");

    expect(current?.textContent).toContain("This device");
    expect(other?.textContent).not.toContain("This device");
  });

  // And the other half: revoking it signs you out of the page you are reading, which is
  // what "Sign out on all devices" is for instead.
  it("offers no revoke on the current session", async () => {
    await render(() => Promise.resolve([session("a", false), session("b", true)]));

    await waitFor(() => expect(screen.getByText("agent-b")).toBeDefined());

    expect(screen.getByText("agent-b").closest("li")?.querySelector("button")).toBeNull();
    expect(screen.getByText("agent-a").closest("li")?.querySelector("button")).not.toBeNull();
  });

  // The row is the whole feedback. Waiting for a round trip to remove a session the user
  // just signed out of reads as a click that did nothing.
  it("takes the row away before the server has answered", async () => {
    // Never resolves, so anything on screen after the click is the optimistic edit.
    await render(
      () => Promise.resolve([session("a", false), session("b", true)]),
      () => new Promise(() => undefined),
    );
    await waitFor(() => expect(screen.getByText("agent-a")).toBeDefined());

    revoke("agent-a");

    await waitFor(() => expect(screen.queryByText("agent-a")).toBeNull());
    expect(screen.getByText("agent-b")).toBeDefined();
  });

  it("puts it back when the revoke fails", async () => {
    // Rejected on a later tick, not immediately: the optimistic edit and the rollback
    // would otherwise land in one batch and the removal would never be observable.
    let fail = (): void => undefined;
    await render(
      () => Promise.resolve([session("a", false), session("b", true)]),
      () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error("nope"));
        }),
    );
    await waitFor(() => expect(screen.getByText("agent-a")).toBeDefined());

    revoke("agent-a");
    await waitFor(() => expect(screen.queryByText("agent-a")).toBeNull());

    fail();

    // Without the rollback the row stays gone until something else refetches the list,
    // so the screen says the session ended and the server says it did not.
    await waitFor(() => expect(screen.getByText("agent-a")).toBeDefined());
  });
});
