import { z } from "../import.js";
import { Identifiers } from "../primitive/index.js";
import { DocAccessContract } from "./doc-access.contract.js";
import { DocNav } from "./doc-nav.js";
import { DocSpaceContract } from "./doc-space.contract.js";

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 300;
// Characters. A page longer than this wants splitting, and the renderer's cost is linear in it.
const MARKDOWN_MAX = 200_000;
// Enough for a deep URL without letting a request carry an unbounded one.
const PATH_MAX = 500;

// `changed` is published with a newer draft behind it. Derived from two version numbers,
// never stored, so it cannot disagree with the row.
const status = z.enum(["draft", "published", "changed"]);

const tocEntry = z.object({
  id: z.string(),
  text: z.string(),
  depth: z.number().int().min(2).max(4),
});

const link = z.url({ protocol: /^https?$/ }).max(2_000);

const node = z.object({
  id: Identifiers.docPageId,
  spaceId: Identifiers.docSpaceId,
  parentId: Identifiers.docPageId.nullable(),
  kind: DocNav.kind,
  slug: DocSpaceContract.slug,
  title: z.string(),
  icon: z.string().nullable(),
  access: DocAccessContract.rule.nullable(),
  position: z.number().int().nonnegative(),
  status,
  updatedAt: z.date(),
});

const published = z.object({
  id: Identifiers.docPageId,
  spaceId: Identifiers.docSpaceId,
  title: z.string(),
  description: z.string().nullable(),
  html: z.string(),
  toc: z.array(tocEntry).readonly(),
  // The source, for "Copy Markdown".
  markdown: z.string(),
  revisionNo: z.number().int().positive(),
  publishedAt: z.date(),
});

const revisionSummary = z.object({
  revisionNo: z.number().int().positive(),
  title: z.string(),
  createdBy: Identifiers.userId,
  createdAt: z.date(),
});

const revisionRef = z.object({
  pageId: Identifiers.docPageId,
  revisionNo: z.number().int().positive(),
});

export class DocPageContract {
  private constructor() {}

  public static readonly kind = DocNav.kind;
  public static readonly status = status;
  public static readonly tocEntry = tocEntry;

  // One row of the editor's tree: every page, drafts included, and no bodies.
  public static readonly node = node;

  public static readonly tree = z.object({ items: z.array(node).readonly() });

  // What the editor opens: the draft, plus enough of the published side to say how far
  // behind it is.
  public static readonly draft = node.extend({
    description: z.string().nullable(),
    markdown: z.string(),
    url: z.string().nullable(),
    // The optimistic lock. A save or a publish naming an older one is a `CONFLICT`.
    draftVersion: z.number().int().positive(),
    revisionNo: z.number().int().nonnegative(),
    publishedAt: z.date().nullable(),
  });

  // What a reader sees: rendered once at publish, never at read.
  public static readonly published = published;

  // An empty `path` is the space's first page.
  public static readonly read = z.object({
    space: DocSpaceContract.slug,
    path: z.string().max(PATH_MAX).default(""),
  });

  // `page` is null only for a space with nothing published yet, which is a state and not
  // an error.
  public static readonly reading = z.object({
    space: DocSpaceContract.view,
    page: published.nullable(),
  });

  public static readonly get = z.object({ pageId: Identifiers.docPageId });

  public static readonly listQuery = z.object({ spaceId: Identifiers.docSpaceId });

  public static readonly create = z.object({
    spaceId: Identifiers.docSpaceId,
    parentId: Identifiers.docPageId.nullable().default(null),
    kind: DocNav.kind.default("page"),
    slug: DocSpaceContract.slug,
    title: z.string().trim().min(1).max(TITLE_MAX),
    icon: z.string().max(40).nullable().default(null),
    url: link.nullable().default(null),
  });

  public static readonly save = z.object({
    pageId: Identifiers.docPageId,
    draftVersion: z.number().int().positive(),
    slug: DocSpaceContract.slug,
    title: z.string().trim().min(1).max(TITLE_MAX),
    description: z.string().trim().max(DESCRIPTION_MAX).nullable(),
    icon: z.string().max(40).nullable(),
    markdown: z.string().max(MARKDOWN_MAX),
    url: link.nullable(),
    // Left out keeps what is stored, so an older client cannot clear it.
    access: DocAccessContract.rule.nullable().optional(),
  });

  public static readonly publish = z.object({
    pageId: Identifiers.docPageId,
    draftVersion: z.number().int().positive(),
  });

  // `position` is the index among the new siblings; the server renumbers the rest.
  public static readonly move = z.object({
    pageId: Identifiers.docPageId,
    parentId: Identifiers.docPageId.nullable(),
    position: z.number().int().nonnegative(),
  });

  public static readonly preview = z.object({ markdown: z.string().max(MARKDOWN_MAX) });

  public static readonly rendered = z.object({
    html: z.string(),
    toc: z.array(tocEntry).readonly(),
  });

  public static readonly revisionSummary = revisionSummary;

  public static readonly revisions = z.object({ items: z.array(revisionSummary).readonly() });

  public static readonly revisionRef = revisionRef;

  public static readonly revision = revisionSummary.extend({
    description: z.string().nullable(),
    markdown: z.string(),
  });

  // Two characters at least: one matches half the corpus and ranks none of it usefully.
  public static readonly search = z.object({
    query: z.string().trim().min(2).max(200),
    limit: z.number().int().positive().max(20).default(10),
  });

  // A heading within a page, or the page itself when `anchor` is null. Plain text: the
  // excerpt is an author's words, and nothing renders it as HTML.
  public static readonly hit = z.object({
    pageId: Identifiers.docPageId,
    spaceSlug: DocSpaceContract.slug,
    spaceTitle: z.string(),
    path: z.string(),
    title: z.string(),
    heading: z.string().nullable(),
    anchor: z.string().nullable(),
    excerpt: z.string(),
  });

  public static readonly hits = z.object({
    items: z.array(DocPageContract.hit).readonly(),
  });

  // Raster images only. An SVG is a document that can carry script, and it would be served
  // from this origin to every reader of the page.
  public static readonly imageType = z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
  ]);

  public static readonly upload = z.object({
    spaceId: Identifiers.docSpaceId,
    contentType: DocPageContract.imageType,
    // Five megabytes. The browser uploads straight to storage, so this is checked here,
    // before a URL is signed, and the URL is only good for five minutes.
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  });

  // `uploadUrl` takes one PUT with the same content type; `url` is what the Markdown links.
  public static readonly uploaded = z.object({
    uploadUrl: z.string(),
    url: z.string(),
  });

  // Into the draft only. Publishing what was restored is a second, deliberate step.
  public static readonly restore = revisionRef.extend({
    draftVersion: z.number().int().positive(),
  });
}

export type DocPageStatus = z.infer<typeof status>;
export type DocTocEntryDto = z.infer<typeof tocEntry>;
export type DocPageNodeDto = z.infer<typeof DocPageContract.node>;
export type DocPageTreeDto = z.infer<typeof DocPageContract.tree>;
export type DocPageDraftDto = z.infer<typeof DocPageContract.draft>;
export type DocPagePublishedDto = z.infer<typeof DocPageContract.published>;
export type DocReadingDto = z.infer<typeof DocPageContract.reading>;
export type ReadDocPageInput = z.infer<typeof DocPageContract.read>;
export type DocPageRefInput = z.infer<typeof DocPageContract.get>;
export type ListDocPagesInput = z.infer<typeof DocPageContract.listQuery>;
export type CreateDocPageInput = z.infer<typeof DocPageContract.create>;
export type SaveDocPageInput = z.infer<typeof DocPageContract.save>;
export type PublishDocPageInput = z.infer<typeof DocPageContract.publish>;
export type MoveDocPageInput = z.infer<typeof DocPageContract.move>;
export type PreviewDocPageInput = z.infer<typeof DocPageContract.preview>;
export type RenderedDocDto = z.infer<typeof DocPageContract.rendered>;
export type DocRevisionSummaryDto = z.infer<typeof DocPageContract.revisionSummary>;
export type DocRevisionListDto = z.infer<typeof DocPageContract.revisions>;
export type DocRevisionRefInput = z.infer<typeof DocPageContract.revisionRef>;
export type DocRevisionDto = z.infer<typeof DocPageContract.revision>;
export type RestoreDocRevisionInput = z.infer<typeof DocPageContract.restore>;
export type SearchDocsInput = z.infer<typeof DocPageContract.search>;
export type DocImageType = z.infer<typeof DocPageContract.imageType>;
export type UploadDocImageInput = z.infer<typeof DocPageContract.upload>;
export type DocImageUploadDto = z.infer<typeof DocPageContract.uploaded>;
export type DocSearchHitDto = z.infer<typeof DocPageContract.hit>;
export type DocSearchHitsDto = z.infer<typeof DocPageContract.hits>;
