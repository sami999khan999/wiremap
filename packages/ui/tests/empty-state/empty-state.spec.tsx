import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../../src/empty-state/empty-state.js";

describe("EmptyState", () => {
  it("takes every string as a prop", () => {
    // No literals anywhere in `ui`. Copy lives in `@loadbearing/content` and arrives
    // through `feature`, which is what keeps the design system translatable.
    render(<EmptyState title="Nothing here yet" description="Add your first one." />);

    expect(screen.getByText("Nothing here yet")).toBeDefined();
    expect(screen.getByText("Add your first one.")).toBeDefined();
  });

  it("omits the description and the icon when absent", () => {
    const { container } = render(<EmptyState title="Nothing here yet" />);

    expect(container.querySelector(".ui-empty-state__description")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the action slot, because an empty state is an invitation to act", () => {
    render(<EmptyState title="Nothing here yet" action={<button type="button">Add one</button>} />);

    expect(screen.getByRole("button", { name: "Add one" })).toBeDefined();
  });

  it("renders an icon when given one", () => {
    const { container } = render(<EmptyState icon="check" title="All done" />);

    expect(container.querySelector("svg")).not.toBeNull();
  });
});
