import type { DocNavNodeDto, DocReadingDto } from "@loadbearing/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

const reading = (pageNumber: number, title: string) =>
  ({
    space: { id: id(99), slug: "guide", title: "Guide", version: 1, theme: null, nav },
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

const mount = (pageNumber: number, title: string) =>
  renderWithFakes(
    <DocReaderPanel
      reading={reading(pageNumber, title)}
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
