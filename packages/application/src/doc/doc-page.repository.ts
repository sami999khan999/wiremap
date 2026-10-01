import type {
  DocAccessRuleDto,
  DocPageId,
  DocPageKind,
  DocSpaceId,
  DocTocEntryDto,
  OrganizationId,
  UserId,
} from "../import.js";
import type { RenderedSection } from "../port/index.js";

// One row of the tree, drafts included and bodies excluded: what every structural
// decision — paths, parents, the published tree — is made from.
export interface DocPageNodeRecord {
  readonly id: DocPageId;
  readonly spaceId: DocSpaceId;
  readonly parentId: DocPageId | null;
  readonly kind: DocPageKind;
  readonly slug: string;
  readonly title: string;
  readonly icon: string | null;
  readonly url: string | null;
  // The page's own rule, added to its space's. Null is none.
  readonly access: DocAccessRuleDto | null;
  readonly position: number;
  readonly draftVersion: number;
  // The draft version the live page was published from. Null is never published.
  readonly publishedDraftVersion: number | null;
  readonly publishedTitle: string | null;
  readonly revisionNo: number;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
}

export interface DocPageDraftRecord extends DocPageNodeRecord {
  readonly description: string | null;
  readonly markdown: string;
}

export interface DocPagePublishedRecord {
  readonly id: DocPageId;
  readonly spaceId: DocSpaceId;
  readonly title: string;
  readonly description: string | null;
  readonly html: string;
  readonly toc: readonly DocTocEntryDto[];
  readonly markdown: string;
  readonly revisionNo: number;
  readonly publishedAt: Date;
}

export interface NewDocPage {
  readonly id: DocPageId;
  readonly spaceId: DocSpaceId;
  readonly parentId: DocPageId | null;
  readonly kind: DocPageKind;
  readonly slug: string;
  readonly title: string;
  readonly icon: string | null;
  readonly url: string | null;
  readonly position: number;
  readonly createdBy: UserId;
}

export interface DocDraftFields {
  readonly slug: string;
  readonly title: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly markdown: string;
  readonly url: string | null;
  readonly access: DocAccessRuleDto | null;
}

export interface DocPublication {
  readonly title: string;
  readonly description: string | null;
  readonly markdown: string;
  readonly html: string;
  readonly toc: readonly DocTocEntryDto[];
  readonly rendererVersion: number;
}

// A published page the current renderer did not write, with what re-rendering needs.
export interface DocStalePageRecord {
  readonly id: DocPageId;
  readonly spaceId: DocSpaceId;
  readonly title: string;
  readonly description: string | null;
  readonly markdown: string;
  readonly revisionNo: number;
}

export interface DocRendering {
  readonly html: string;
  readonly toc: readonly DocTocEntryDto[];
  readonly rendererVersion: number;
}

export interface DocRevisionSummaryRecord {
  readonly revisionNo: number;
  readonly title: string;
  readonly createdBy: UserId;
  readonly createdAt: Date;
}

// One match: a heading's section, or a page's title when `anchor` is null. Ranked across
// both kinds on one scale, so the caller merges without re-ranking.
export interface DocSearchMatch {
  readonly pageId: DocPageId;
  readonly spaceId: DocSpaceId;
  readonly anchor: string | null;
  readonly heading: string | null;
  readonly excerpt: string;
  readonly rank: number;
}

export interface DocRevisionRecord extends DocRevisionSummaryRecord {
  readonly description: string | null;
  readonly markdown: string;
}

// Pages, their revisions and their search sections: one placement, one repository.
// Every method takes the tenant first.
export abstract class DocPageRepository {
  // Ordered by parent, then position: the order the tree is built in.
  public abstract listBySpace(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
  ): Promise<readonly DocPageNodeRecord[]>;

  public abstract findDraft(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<DocPageDraftRecord | null>;

  // Null for a page never published, as well as for one that does not exist.
  public abstract findPublished(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<DocPagePublishedRecord | null>;

  public abstract create(organizationId: OrganizationId, page: NewDocPage): Promise<void>;

  // Only when the row is still at `expectedVersion`. False is a stale editor, and the
  // row lock is what makes two saves racing for one version produce exactly one winner.
  public abstract saveDraft(
    organizationId: OrganizationId,
    pageId: DocPageId,
    expectedVersion: number,
    fields: DocDraftFields,
    updatedBy: UserId,
  ): Promise<boolean>;

  // The same lock, and the revision counter moves under it. Null is a stale editor;
  // otherwise the new revision number.
  public abstract publish(
    organizationId: OrganizationId,
    pageId: DocPageId,
    expectedVersion: number,
    publication: DocPublication,
    publishedBy: UserId,
  ): Promise<number | null>;

  public abstract saveRevision(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    pageId: DocPageId,
    revisionNo: number,
    publication: DocPublication,
    createdBy: UserId,
  ): Promise<void>;

  // Replaces the page's search rows in one statement pair, inside the publish.
  // Published pages rendered before `version`, oldest renderer first.
  public abstract listStale(
    organizationId: OrganizationId,
    version: number,
    limit: number,
  ): Promise<readonly DocStalePageRecord[]>;

  // The published HTML and outline only: no revision, no draft, no publish time moves.
  public abstract saveRendering(
    organizationId: OrganizationId,
    pageId: DocPageId,
    rendering: DocRendering,
  ): Promise<void>;

  public abstract saveSections(
    organizationId: OrganizationId,
    spaceId: DocSpaceId,
    pageId: DocPageId,
    sections: readonly RenderedSection[],
  ): Promise<void>;

  // Full text over the published sections, and published titles by prefix and typo, in
  // one statement. Tenant-scoped like everything else; the caller narrows by space.
  public abstract search(
    organizationId: OrganizationId,
    query: string,
    limit: number,
  ): Promise<readonly DocSearchMatch[]>;

  public abstract listRevisions(
    organizationId: OrganizationId,
    pageId: DocPageId,
  ): Promise<readonly DocRevisionSummaryRecord[]>;

  public abstract findRevision(
    organizationId: OrganizationId,
    pageId: DocPageId,
    revisionNo: number,
  ): Promise<DocRevisionRecord | null>;

  // Sets the parent and the position of each listed page, in list order.
  public abstract saveOrder(
    organizationId: OrganizationId,
    parentId: DocPageId | null,
    orderedIds: readonly DocPageId[],
  ): Promise<void>;

  // The pages with their revisions and sections. The caller names the whole subtree.
  public abstract delete(
    organizationId: OrganizationId,
    pageIds: readonly DocPageId[],
  ): Promise<void>;

  public abstract deleteBySpace(organizationId: OrganizationId, spaceId: DocSpaceId): Promise<void>;
}
