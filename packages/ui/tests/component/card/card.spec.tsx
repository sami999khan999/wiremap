import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardGrid } from "../../../src/component/card/card.js";

describe("Card", () => {
  it("is one link as a whole when it has a destination", () => {
    render(<Card title="Core" description="The logic" href="/core" />);
    const link = screen.getByRole("link");
    expect(link.className).toBe("ui-card");
    expect(link.textContent).toContain("The logic");
  });

  it("hands the caller's router the destination and the class", () => {
    render(
      <Card
        title="UI"
        href="/ui"
        renderLink={(href, content, attributes) => (
          <a data-router href={href} {...attributes}>
            {content}
          </a>
        )}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.hasAttribute("data-router")).toBe(true);
    expect(link.className).toBe("ui-card");
  });

  // The shape the Markdown renderer emits, so one stylesheet covers both.
  it("is a plain block without one", () => {
    const { container } = render(
      <CardGrid>
        <Card title="Static" />
      </CardGrid>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector(".ui-card-grid > div.ui-card")).not.toBeNull();
  });
});
