import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type DocSearchHit, DocSearchPanel } from "../../src/doc/doc-search.panel.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const HITS: readonly DocSearchHit[] = [
  {
    id: "a",
    title: "Install",
    href: "/docs/guide/install",
    spaceSlug: "guide",
    spaceTitle: "Guide",
  },
  { id: "b", title: "Keys", href: "/docs/api/keys", spaceSlug: "api", spaceTitle: "API" },
];

describe("DocSearchPanel", () => {
  // The whole docs are searched: the open space's text first, every other under its name.
  it("groups text hits by space, the open one first", async () => {
    await renderWithFakes(
      <DocSearchPanel
        nav={[]}
        base="/docs/guide"
        renderLink={(href, content, attributes) => (
          <a href={href} {...attributes}>
            {content}
          </a>
        )}
        search={() => Promise.resolve(HITS)}
      />,
      capabilitiesWith([]),
      undefined,
      ["doc"],
    );

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.change(screen.getByRole("combobox", { hidden: true }), {
      target: { value: "ke" },
    });

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "In the text", hidden: true })).toBeDefined(),
    );
    const groups = screen
      .getAllByRole("group", { hidden: true })
      .map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["In the text", "In API"]);
  });
});
