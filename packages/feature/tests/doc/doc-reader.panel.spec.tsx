import type { DocNavNodeDto, DocReadingDto } from "@loadbearing/contracts";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocNavTree } from "../../src/doc/doc-nav-tree.js";
import { DocReaderPanel } from "../../src/doc/doc-reader.panel.js";
import { capabilitiesWith, renderWithFakes } from "../support/render-with-fakes.js";

const id = (n: number) => `018f8c00-0000-7000-8000-${String(n).padStart(12, "0")}`;
const leaf = (n: number, title: string, path: string): DocNavNodeDto =>
  ({
    id: id(n),
    kind: "page",
    title,
    icon: null,
    path,
    url: null,
    revisionNo: 1,
    children: [],
  }) as unknown as DocNavNodeDto;

const nav: DocNavNodeDto[] = [
  {
    ...leaf(1, "Guides", ""),
    kind: "section",
    path: null,
    revisionNo: null,
    children: [leaf(2, "Install", "install"), leaf(3, "Configure", "configure")],
  } as unknown as DocNavNodeDto,
  leaf(4, "Deploy", "deploy"),
];

const reading = (pageNumber: number, title: string, repositoryUrl: string | null = null) =>
  ({
    space: {
      id: id(99),
      slug: "guide",
      title: "Guide",
      version: 1,
      theme: null,
      nav,
      repositoryUrl,
    },
    page: {
      id: id(pageNumber),
      spaceId: id(99),
      title,
      description: null,
      html: "<p>body</p>",
      toc: [],
      markdown: "body",
      revisionNo: 1,
      publishedAt: new Date(0),
    },
  }) as unknown as DocReadingDto;

const mount = (
  pageNumber: number,
  title: string,
  extra: { repositoryUrl?: string; markdownHref?: string } = {},
) =>
  renderWithFakes(
    <DocReaderPanel
      reading={reading(pageNumber, title, extra.repositoryUrl ?? null)}
      markdownHref={extra.markdownHref ?? null}
      spaces={[]}
      root="/docs"
      renderLink={(href, content, attributes) => (
        <a href={href} {...attributes}>
          {content}
        </a>
      )}
      onSelectSpace={() => {}}
      appearance={{ theme: "slate", mode: "light", onChange: () => {} }}
    />,
    capabilitiesWith([]),
    undefined,
    ["doc"],
  );

describe("DocReaderPanel — reading aids", () => {
  // In reading order across a section boundary, as the sidebar lists the pages.
  it("links the previous and next page in reading order", async () => {
    await mount(3, "Configure");
    const pager = screen.getByRole("navigation", { name: "More pages" });
    const links = [...pager.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(links).toEqual(["/docs/guide/install", "/docs/guide/deploy"]);
  });

  it("shows the section above the page as a breadcrumb", async () => {
    await mount(2, "Install");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Guides");
  });

  it("offers no previous link on the first page", async () => {
    await mount(2, "Install");
    const pager = screen.getByRole("navigation", { name: "More pages" });
    expect([...pager.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "NextConfigure",
    ]);
  });
});

describe("DocReaderPanel — repository and Open in", () => {
  it("links the space's repository from the sidebar footer, and only when it has one", async () => {
    const view = await mount(2, "Install", { repositoryUrl: "https://github.com/acme/docs" });
    const link = screen.getByRole("link", { name: "Source repository" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/docs");
    expect(link.getAttribute("target")).toBe("_blank");

    view.unmount();
    await mount(2, "Install");
    expect(screen.queryByRole("link", { name: "Source repository" })).toBeNull();
  });

  // The tools fetch the page themselves, so the prompt carries the absolute source URL.
  it("offers ChatGPT and Claude with the page's absolute Markdown URL", async () => {
    await mount(2, "Install", { markdownHref: "/api/doc/guide/install" });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const source = encodeURIComponent(`${location.origin}/api/doc/guide/install`);
    const claude = await screen.findByRole("link", { name: "Open in Claude" });
    expect(claude.getAttribute("href")).toContain("https://claude.ai/new?q=");
    expect(claude.getAttribute("href")).toContain(source);
    const chatgpt = screen.getByRole("link", { name: "Open in ChatGPT" });
    expect(chatgpt.getAttribute("href")).toContain("https://chatgpt.com/?hints=search&q=");
  });

  it("offers neither without a fetchable source", async () => {
    await mount(2, "Install");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in Claude" })).toBeNull();
  });
});

describe("DocNavTree.isLinked", () => {
  const rule = { module: null, permission: "rbac.role.manage", flag: null, plan: null };
  const linkedSection = [
    { ...nav[0], access: rule } as unknown as DocNavNodeDto,
    nav[1] as DocNavNodeDto,
  ];

  it("is false for a page with no link anywhere above it", () => {
    expect(DocNavTree.isLinked(null, nav, id(2))).toBe(false);
  });

  it("is true when the space, the page, or a section above it carries a link", () => {
    expect(DocNavTree.isLinked(rule, nav, id(2))).toBe(true);
    expect(DocNavTree.isLinked(null, linkedSection, id(2))).toBe(true);
    expect(DocNavTree.isLinked(null, linkedSection, id(4))).toBe(false);
  });

  // An all-null rule is the same as none: it narrows nothing.
  it("ignores a rule whose four keys are all empty", () => {
    const empty = { module: null, permission: null, flag: null, plan: null };
    expect(DocNavTree.isLinked(empty, nav, id(2))).toBe(false);
  });
});
