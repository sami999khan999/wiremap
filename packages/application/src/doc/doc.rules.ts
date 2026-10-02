import {
  type DocNavNodeDto,
  type DocPageId,
  type DocPageStatus,
  type DocSpaceAudience,
  ForbiddenError,
  NotFoundError,
  type UserId,
  ValidationError,
} from "../import.js";
import type { Principal } from "../primitive/index.js";
import type { DocPageNodeRecord } from "./doc-page.repository.js";
import type { DocSpaceSummary } from "./doc-space.repository.js";

// The segments `/doc/…` already spends on the editor and the settings screen. A space
// named either would be unreachable.
const RESERVED_SPACE_SLUGS: ReadonlySet<string> = new Set(["edit", "manage"]);

// Deep enough for any docs site worth reading; shallow enough that a recursive walk and
// a sidebar both stay sane.
const MAX_DEPTH = 6;

type Children = ReadonlyMap<DocPageId | null, readonly DocPageNodeRecord[]>;

// What the `owner` rules read off a space, so a summary and a full record both qualify.
type OwnedSpace = Pick<DocSpaceSummary, "audience" | "createdBy">;

// The structural decisions, all pure: what a path is, what the published tree looks like,
// and which trees are allowed. See packages/application/docs/reference/doc.md.
export class DocRules {
  private constructor() {}

  public static assertSpaceSlug(slug: string): void {
    if (RESERVED_SPACE_SLUGS.has(slug)) {
      throw new ValidationError([{ field: "slug", rule: "invalid" }]);
    }
  }

  // `public` and `granted` put a space in front of people outside its organization, which
  // only the platform organization may do. `members` and `owner` never leave it.
  public static assertAudience(audience: DocSpaceAudience, isPlatform: boolean): void {
    if (audience !== "members" && audience !== "owner" && !isPlatform) {
      throw new ValidationError([{ field: "audience", rule: "invalid" }]);
    }
  }

  // Opening a space to the internet, or to other tenants, is a platform decision rather than
  // "can arrange spaces": only a holder of `platform.doc.grant` moves a space onto either.
  public static assertMayOpen(
    actor: Principal,
    audience: DocSpaceAudience,
    current: DocSpaceAudience | null,
  ): void {
    const open = audience === "public" || audience === "granted";
    if (open && audience !== current && !actor.can("platform.doc.grant")) {
      throw new ForbiddenError("platform.doc.grant");
    }
  }

  // `owner` is the author's alone. Anyone else, an admin included, is told the space
  // does not exist, so an owner space's slug cannot be probed.
  public static isVisible(space: OwnedSpace, viewer: UserId | null): boolean {
    return space.audience !== "owner" || viewer === space.createdBy;
  }

  // The same, as the guard every read and write of a space calls before it touches it.
  // The caller names what was asked for: a page in a hidden space is a page not found.
  public static assertVisible<T extends OwnedSpace>(
    space: T | null,
    viewer: UserId | null,
    resource: "doc.space" | "doc.page",
    ref: string,
  ): T {
    if (!space || !DocRules.isVisible(space, viewer)) throw new NotFoundError(resource, ref);
    return space;
  }

  // Only the author may make a space `owner`: from anyone else it would lock the author
  // and every other member out of a space they could all read a moment ago.
  public static assertAudienceChange(
    space: OwnedSpace,
    audience: DocSpaceAudience,
    actor: UserId,
  ): void {
    if (audience === "owner" && space.audience !== "owner" && actor !== space.createdBy) {
      throw new ValidationError([{ field: "audience", rule: "invalid" }]);
    }
  }

  // A grant widens who may read, and an owner space is the author's alone. Refused rather
  // than ignored, so the admin learns why the grant did nothing.
  public static assertGrantable(space: OwnedSpace): void {
    if (space.audience === "owner") {
      throw new ValidationError([{ field: "spaceId", rule: "private" }]);
    }
  }

  // Derived from two numbers on the row rather than stored, so it cannot drift.
  public static status(node: DocPageNodeRecord): DocPageStatus {
    if (node.publishedDraftVersion === null) return "draft";
    return node.publishedDraftVersion === node.draftVersion ? "published" : "changed";
  }

  // Called with the tree as it would be after a change, before the change is written: a
  // parent that exists, no cycle, nothing under a link, a bounded depth, unique paths.
  public static assertTree(nodes: readonly DocPageNodeRecord[]): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const paths = new Set<string>();

    for (const node of nodes) {
      let depth = 0;
      let cursor = node.parentId;
      while (cursor !== null) {
        const parent = byId.get(cursor);
        if (!parent || parent.kind === "link" || cursor === node.id || depth >= MAX_DEPTH) {
          throw new ValidationError([{ field: "parentId", rule: "invalid" }]);
        }
        depth += 1;
        cursor = parent.parentId;
      }

      const path = DocRules.pathOf(node, byId);
      if (path === null) continue;
      if (paths.has(path)) throw new ValidationError([{ field: "slug", rule: "taken" }]);
      paths.add(path);
    }
  }

  // The page and everything under it, the page first.
  public static subtree(nodes: readonly DocPageNodeRecord[], pageId: DocPageId): DocPageId[] {
    const children = DocRules.children(nodes);
    const out: DocPageId[] = [];
    const walk = (id: DocPageId): void => {
      out.push(id);
      for (const child of children.get(id) ?? []) walk(child.id);
    };
    walk(pageId);
    return out;
  }

  // The sidebar readers see. An unpublished page drops out with everything under it, since
  // their paths run through it; a section with nothing published under it drops out too.
  public static buildNav(nodes: readonly DocPageNodeRecord[]): DocNavNodeDto[] {
    const children = DocRules.children(nodes);

    const build = (parentId: DocPageId | null, prefix: string): DocNavNodeDto[] =>
      (children.get(parentId) ?? []).flatMap((node): DocNavNodeDto[] => {
        if (node.kind === "link") {
          return [DocRules.navNode(node, node.title, null, node.url, null, [])];
        }
        if (node.kind === "section") {
          const under = build(node.id, prefix);
          return under.length === 0
            ? []
            : [DocRules.navNode(node, node.title, null, null, null, under)];
        }
        if (node.publishedDraftVersion === null) return [];

        const path = prefix.length === 0 ? node.slug : `${prefix}/${node.slug}`;
        const title = node.publishedTitle ?? node.title;
        return [DocRules.navNode(node, title, path, null, node.revisionNo, build(node.id, path))];
      });

    return build(null, "");
  }

  // An empty path is the first page in reading order, which is where a space opens.
  public static find(nav: readonly DocNavNodeDto[], path: string): DocNavNodeDto | null {
    const wanted = path.replace(/^\/+|\/+$/g, "");
    for (const node of nav) {
      if (node.kind === "page" && (wanted.length === 0 || node.path === wanted)) return node;
      const found = DocRules.find(node.children, wanted);
      if (found) return found;
    }
    return null;
  }

  // What a page read carries: every section's pages, and the children of the pages above
  // the one being read. Every other page's children are folded and fetched with the tree.
  public static trimNav(
    nav: readonly DocNavNodeDto[],
    activeId: DocPageId | null,
  ): DocNavNodeDto[] {
    return nav.map((node): DocNavNodeDto => {
      if (node.children.length === 0) return node;
      if (node.kind === "section" || (activeId !== null && DocRules.holds(node, activeId))) {
        return { ...node, children: DocRules.trimNav(node.children, activeId) };
      }
      return { ...node, children: [], folded: true };
    });
  }

  private static holds(node: DocNavNodeDto, pageId: DocPageId): boolean {
    return node.children.some((child) => child.id === pageId || DocRules.holds(child, pageId));
  }

  // A page by id, for turning a search match back into the path a reader opens.
  public static locate(nav: readonly DocNavNodeDto[], pageId: DocPageId): DocNavNodeDto | null {
    for (const node of nav) {
      if (node.id === pageId) return node;
      const found = DocRules.locate(node.children, pageId);
      if (found) return found;
    }
    return null;
  }

  private static navNode(
    node: DocPageNodeRecord,
    title: string,
    path: string | null,
    url: string | null,
    revisionNo: number | null,
    children: readonly DocNavNodeDto[],
  ): DocNavNodeDto {
    return {
      id: node.id,
      kind: node.kind,
      title,
      icon: node.icon,
      path,
      url,
      revisionNo,
      children,
      ...(node.access ? { access: node.access } : {}),
    };
  }

  // Sections add no segment, so a page under "Guides" is `/writing`, not `/guides/writing`.
  private static pathOf(
    node: DocPageNodeRecord,
    byId: ReadonlyMap<DocPageId, DocPageNodeRecord>,
  ): string | null {
    if (node.kind !== "page") return null;
    const segments = [node.slug];
    let cursor = node.parentId;
    while (cursor !== null) {
      const parent = byId.get(cursor);
      if (!parent) break;
      if (parent.kind === "page") segments.unshift(parent.slug);
      cursor = parent.parentId;
    }
    return segments.join("/");
  }

  // Siblings in reading order: position, then title so a tie is stable.
  private static children(nodes: readonly DocPageNodeRecord[]): Children {
    const grouped = new Map<DocPageId | null, DocPageNodeRecord[]>();
    for (const node of nodes) {
      const bucket = grouped.get(node.parentId);
      if (bucket) bucket.push(node);
      else grouped.set(node.parentId, [node]);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    }
    return grouped;
  }
}
