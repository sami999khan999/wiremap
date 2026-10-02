import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageScrollbar } from "../../../src/component/page-scrollbar/page-scrollbar.js";
import { ScrollArea } from "../../../src/component/scroll-area/scroll-area.js";

describe("ScrollArea", () => {
  // One stylesheet for the whole page: an area inside PageScrollbar inherits its theme.
  it("adds no stylesheet of its own inside PageScrollbar", () => {
    const { container } = render(
      <PageScrollbar>
        <ScrollArea className="h-40" contentClassName="px-4" label="Pages">
          <p>body</p>
        </ScrollArea>
      </PageScrollbar>,
    );
    expect(container.querySelectorAll("style[data-glass-scroll]")).toHaveLength(1);
  });

  it("names the scroller, pads it, and gives the area its own overlay", () => {
    const { container } = render(
      <PageScrollbar>
        <ScrollArea className="h-40" contentClassName="px-4" label="Pages">
          <p>body</p>
        </ScrollArea>
      </PageScrollbar>,
    );
    const scroller = screen.getByRole("region", { name: "Pages" });
    expect(scroller.className).toContain("px-4");
    expect(container.querySelector(".gs-area.h-40 .gs-root--local")).not.toBeNull();
  });
});
