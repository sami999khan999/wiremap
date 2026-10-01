import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  NavTree,
  type NavTreeNode,
  type RenderNavLink,
} from "../../../src/component/nav-tree/nav-tree.js";

const NODES: readonly NavTreeNode[] = [
  {
    id: "intro",
    kind: "section",
    label: "Introduction",
    children: [
      { id: "start", kind: "page", label: "Quick Start", href: "/start" },
      {
        id: "guides",
        kind: "page",
        label: "Guides",
        href: "/guides",
        children: [{ id: "deploy", kind: "page", label: "Deploying", href: "/guides/deploy" }],
      },
      { id: "repo", kind: "link", label: "Source", href: "https://example.com" },
    ],
  },
];

const renderLink: RenderNavLink = (node, content, attributes) => (
  <a href={node.href} {...attributes}>
    {content}
  </a>
);

const mount = (activeId?: string) =>
  render(
    <NavTree
      label="Docs"
      nodes={NODES}
      renderLink={renderLink}
      activeId={activeId}
      expandLabel="Expand"
      collapseLabel="Collapse"
    />,
  );

describe("NavTree", () => {
  it("renders a section as a heading over its pages", () => {
    mount();
    expect(screen.getByText("Introduction").tagName).toBe("P");
    expect(screen.getByRole("link", { name: "Quick Start" }).getAttribute("href")).toBe("/start");
  });

  // The attributes travel to the caller's link: the router builds the element, not this.
  it("marks the active page on the caller's link", () => {
    mount("start");
    const link = screen.getByRole("link", { name: "Quick Start" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.className).toContain("ui-nav-tree__link--active");
  });

  it("keeps a branch closed until it is toggled", () => {
    mount();
    const toggle = screen.getByRole("button", { name: "Expand Guides" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Deploying" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse Guides" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Deploying" })).toBeDefined();
  });

  it("opens the branch that holds the active page", () => {
    mount("deploy");
    expect(screen.getByRole("link", { name: "Deploying" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  // Outside the app, so never the router's element.
  it("renders an external link as a plain anchor in a new tab", () => {
    mount();
    const link = screen.getByRole("link", { name: "Source" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });
});
