import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Zone, type ZoneItem } from "../../src/zone/zone.js";

const ITEMS: readonly ZoneItem[] = [
  { key: "b", title: "Second by key, first by order", content: <p>one</p> },
  { key: "a", title: "First by key, second by order", content: <p>two</p> },
];

describe("Zone", () => {
  // The caller decides the order; sorting here would be a policy a layout does not own.
  it("renders the units in the order they were given", () => {
    render(<Zone label="Main" items={ITEMS} />);

    const titles = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(titles).toEqual(["Second by key, first by order", "First by key, second by order"]);
  });

  // It has no visible heading, so the label is the only name a screen reader hears.
  it("names its region with the label", () => {
    render(<Zone label="Dashboard" items={ITEMS} />);

    expect(screen.getByRole("region", { name: "Dashboard" }).className).toBe("ui-zone");
  });

  it("puts an action in the unit's header, beside its title", () => {
    render(
      <Zone
        label="Main"
        items={[
          { key: "a", title: "Members", content: "4", action: <button type="button">Hide</button> },
        ]}
      />,
    );

    const header = screen.getByRole("heading", { name: "Members" }).parentElement as HTMLElement;
    expect(within(header).getByRole("button", { name: "Hide" }).parentElement?.className).toBe(
      "ui-zone__action",
    );
  });

  it("renders no action slot when there is no action", () => {
    const { container } = render(<Zone label="Main" items={ITEMS} />);

    expect(container.querySelector(".ui-zone__action")).toBeNull();
  });

  it("renders the empty state for no units, still inside the named region", () => {
    render(<Zone label="Main" items={[]} empty={<p>Nothing to show.</p>} />);

    expect(
      within(screen.getByRole("region", { name: "Main" })).getByText("Nothing to show."),
    ).toBeDefined();
  });

  // Nothing at all, not an empty grid: a gap with a border around it reads as broken.
  it("renders nothing for no units and no empty state", () => {
    const { container } = render(<Zone label="Main" items={[]} />);

    expect(container.innerHTML).toBe("");
  });
});
