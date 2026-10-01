import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toc } from "../../../src/component/toc/toc.js";

const ITEMS = [
  { id: "intro", text: "Introduction", depth: 2 },
  { id: "terms", text: "Terminology", depth: 3 },
] as const;

describe("Toc", () => {
  it("links each heading by its id, indented from the shallowest", () => {
    render(<Toc title="On this page" items={ITEMS} />);
    const link = screen.getByRole("link", { name: "Terminology" });
    expect(link.getAttribute("href")).toBe("#terms");
    expect(link.closest("li")?.getAttribute("data-depth")).toBe("1");
  });

  // jsdom has no IntersectionObserver, which is the state a first paint is in anyway.
  it("marks the first heading current before anything is observed", () => {
    render(<Toc title="On this page" items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Introduction" }).getAttribute("aria-current")).toBe(
      "location",
    );
  });

  it("renders nothing for a page with no headings", () => {
    const { container } = render(<Toc title="On this page" items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
