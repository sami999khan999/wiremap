import {
  type DocNavNodeDto,
  type DocSearchHitDto,
  type IconName,
  IconRegistry,
  type NavTreeNode,
} from "../import.js";
import type { DocSearchHit } from "./doc-search.panel.js";

// The published tree as the sidebar and the palette see it. Stateless, so both the reader
// and the search build from one mapping and never disagree about an href.
export class DocNavTree {
  private constructor() {}

  // `base` is the space's own root — `/doc/guides` or `/docs/guides`.
  // Whether a page read left any branch out, which is when the full tree is worth fetching.
  public static isFolded(nav: readonly DocNavNodeDto[]): boolean {
    return nav.some((node) => node.folded === true || DocNavTree.isFolded(node.children));
  }

  public static toNodes(nav: readonly DocNavNodeDto[], base: string): NavTreeNode[] {
    return nav.map((node): NavTreeNode => {
      const icon = DocNavTree.icon(node.icon);
      const href =
        node.kind === "link"
          ? (node.url ?? undefined)
          : node.path
            ? `${base}/${node.path}`
            : undefined;
      return {
        id: node.id,
        kind: node.kind,
        label: node.title,
        ...(href ? { href } : {}),
        ...(icon ? { icon } : {}),
        ...(node.children.length > 0 ? { children: DocNavTree.toNodes(node.children, base) } : {}),
      };
    });
  }

  // Every page in reading order, each with the sections above it for context.
  public static pages(
    nav: readonly DocNavNodeDto[],
    trail: readonly string[] = [],
  ): { readonly node: DocNavNodeDto; readonly trail: readonly string[] }[] {
    return nav.flatMap((node) => {
      const here = node.kind === "page" ? [{ node, trail }] : [];
      return [...here, ...DocNavTree.pages(node.children, [...trail, node.title])];
    });
  }

  // Server matches as palette entries. A heading match opens at the heading, and its title
  // names the page it is on, since two pages can both have an "Installation".
  public static hits(items: readonly DocSearchHitDto[], root: string): DocSearchHit[] {
    return items.map((hit) => ({
      id: `${hit.pageId}#${hit.anchor ?? ""}`,
      title: hit.heading ? `${hit.title} › ${hit.heading}` : hit.title,
      href: `${root}/${hit.spaceSlug}/${hit.path}${hit.anchor ? `#${hit.anchor}` : ""}`,
      ...(hit.excerpt ? { excerpt: hit.excerpt } : {}),
    }));
  }

  // A starting address from a title. The author can change it; the server still checks it.
  public static slugify(title: string): string {
    return title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  // Validated rather than cast: a stored name can outlive the sprite that drew it.
  public static icon(name: string | null): IconName | undefined {
    return name !== null && IconRegistry.isKnown(name) ? name : undefined;
  }
}
