import type { ApiClient } from "@loadbearing/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationPreferenceForm } from "../../src/notification/notification-preference.form.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const GRID = [
  { category: "membership", channel: "in_app", mode: "immediate" },
  { category: "membership", channel: "email", mode: "digest" },
];

const clientWith = (updatePreference: () => Promise<{ ok: true }>) =>
  ({
    notification: {
      preferences: () => Promise.resolve({ items: GRID }),
      updatePreference,
    },
  }) as unknown as ApiClient;

const render = (updatePreference = () => Promise.resolve({ ok: true as const })) =>
  renderWithFakes(
    <NotificationPreferenceForm />,
    capabilitiesWith([]),
    undefined,
    ["notification"],
    clientWith(updatePreference),
  );

describe("NotificationPreferenceForm", () => {
  // The grid is the resolved one the server sends, not the stored rows: a person who has
  // never touched this screen must still see every choice they have.
  it("renders one fieldset per category and channel", async () => {
    const { container } = await render();

    await waitFor(() => expect(container.querySelectorAll("fieldset").length).toBe(2));
  });

  // `aria-pressed` is the only thing saying which of the three is current, since these
  // are buttons rather than a radio group.
  it("marks the saved mode as pressed", async () => {
    const { container } = await render();

    await waitFor(() => expect(container.querySelector("fieldset")).not.toBeNull());

    const pressed = [...container.querySelectorAll('[aria-pressed="true"]')];
    expect(pressed.length).toBe(2);
  });

  it("sends the category, channel and mode of the button clicked", async () => {
    const updatePreference = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { container } = await render(updatePreference);

    await waitFor(() => expect(container.querySelector("fieldset")).not.toBeNull());

    const fieldset = container.querySelector("fieldset") as HTMLFieldSetElement;
    const off = [...fieldset.querySelectorAll("button")].at(-1) as HTMLButtonElement;
    fireEvent.click(off);

    await waitFor(() =>
      expect(updatePreference).toHaveBeenCalledWith({
        category: "membership",
        channel: "in_app",
        mode: "off",
      }),
    );
  });

  // A failed save leaves the buttons where they were — this form is deliberately not
  // optimistic — so the callout is the only thing that says it did not take.
  it("shows the error the server sent when a save fails", async () => {
    await render(() => Promise.reject(new Error("FORBIDDEN")));

    await waitFor(() => expect(screen.getAllByRole("button", { name: /off/i })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: /off/i })[0] as HTMLElement);

    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
